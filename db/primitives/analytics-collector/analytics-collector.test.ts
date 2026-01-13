/**
 * AnalyticsCollector Tests
 *
 * RED phase: These tests define the expected behavior of AnalyticsCollector.
 * All tests should FAIL until implementation is complete.
 *
 * AnalyticsCollector provides Segment-compatible event collection:
 * - Event Collection: track(), page(), screen(), identify()
 * - User Sessions: session tracking, device detection, referrer tracking
 * - Batching: automatic event batching with flush intervals
 * - User Identification: anonymous ID -> user ID resolution
 * - Context Enrichment: automatic context (IP, user agent, geo)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AnalyticsCollector,
  type AnalyticsCollectorOptions,
  type TrackEvent,
  type PageEvent,
  type ScreenEvent,
  type IdentifyEvent,
  type GroupEvent,
  type AliasEvent,
  type AnalyticsContext,
  type Session,
  type UserIdentity,
  type BatchResult,
  type Destination,
  createAnalyticsCollector,
} from './index'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMockDestination(): Destination & { events: unknown[] } {
  const events: unknown[] = []
  return {
    name: 'mock',
    events,
    send: async (batch) => {
      events.push(...batch)
      return { success: true, count: batch.length }
    },
  }
}

// ============================================================================
// ANALYTICS COLLECTOR - CREATION AND CONFIGURATION
// ============================================================================

describe('AnalyticsCollector', () => {
  describe('creation', () => {
    it('should create with required options', () => {
      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
      })
      expect(analytics).toBeDefined()
      expect(analytics.writeKey).toBe('test-key')
    })

    it('should create with all options', () => {
      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        flushAt: 20,
        flushInterval: 10000,
        maxQueueSize: 1000,
        retries: 3,
      })
      expect(analytics.options.flushAt).toBe(20)
      expect(analytics.options.flushInterval).toBe(10000)
      expect(analytics.options.maxQueueSize).toBe(1000)
      expect(analytics.options.retries).toBe(3)
    })

    it('should use defaults for optional fields', () => {
      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
      })
      expect(analytics.options.flushAt).toBe(20) // default
      expect(analytics.options.flushInterval).toBe(10000) // default 10s
      expect(analytics.options.maxQueueSize).toBe(10000) // default
      expect(analytics.options.retries).toBe(3) // default
    })

    it('should reject empty writeKey', () => {
      expect(() => createAnalyticsCollector({ writeKey: '' })).toThrow(
        'writeKey is required'
      )
    })

    it('should support custom destinations', () => {
      const mockDest = createMockDestination()
      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
      })
      expect(analytics.options.destinations).toHaveLength(1)
    })
  })

  describe('class instantiation', () => {
    it('should work with new keyword', () => {
      const analytics = new AnalyticsCollector({
        writeKey: 'test-key',
      })
      expect(analytics).toBeInstanceOf(AnalyticsCollector)
    })
  })
})

// ============================================================================
// TRACK EVENT - CUSTOM EVENT TRACKING
// ============================================================================

describe('Track Event', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1, // Flush immediately for testing
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  describe('basic tracking', () => {
    it('should track event with userId', async () => {
      await analytics.track({
        event: 'Button Clicked',
        userId: 'user_123',
      })

      await analytics.flush()
      expect(mockDest.events).toHaveLength(1)
      expect(mockDest.events[0]).toMatchObject({
        type: 'track',
        event: 'Button Clicked',
        userId: 'user_123',
      })
    })

    it('should track event with anonymousId', async () => {
      await analytics.track({
        event: 'Page Loaded',
        anonymousId: 'anon_456',
      })

      await analytics.flush()
      expect(mockDest.events[0]).toMatchObject({
        type: 'track',
        event: 'Page Loaded',
        anonymousId: 'anon_456',
      })
    })

    it('should track event with properties', async () => {
      await analytics.track({
        event: 'Item Purchased',
        userId: 'user_123',
        properties: {
          productId: 'prod_abc',
          price: 99.99,
          currency: 'USD',
          quantity: 2,
        },
      })

      await analytics.flush()
      expect(mockDest.events[0]).toMatchObject({
        properties: {
          productId: 'prod_abc',
          price: 99.99,
          currency: 'USD',
          quantity: 2,
        },
      })
    })

    it('should require userId or anonymousId', async () => {
      await expect(
        analytics.track({
          event: 'Invalid Event',
        } as TrackEvent)
      ).rejects.toThrow('userId or anonymousId is required')
    })

    it('should require event name', async () => {
      await expect(
        analytics.track({
          event: '',
          userId: 'user_123',
        })
      ).rejects.toThrow('event name is required')
    })

    it('should generate messageId', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
      })

      await analytics.flush()
      expect(mockDest.events[0]).toHaveProperty('messageId')
      expect((mockDest.events[0] as { messageId: string }).messageId).toMatch(
        /^[a-f0-9-]+$/
      )
    })

    it('should use provided messageId for deduplication', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        messageId: 'custom-msg-id',
      })

      await analytics.flush()
      expect((mockDest.events[0] as { messageId: string }).messageId).toBe(
        'custom-msg-id'
      )
    })

    it('should add timestamp', async () => {
      const before = new Date()
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
      })
      const after = new Date()

      await analytics.flush()
      const timestamp = new Date((mockDest.events[0] as { timestamp: string }).timestamp)
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should use provided timestamp', async () => {
      const customTime = new Date('2025-06-15T12:00:00Z')
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        timestamp: customTime,
      })

      await analytics.flush()
      expect((mockDest.events[0] as { timestamp: string }).timestamp).toBe(
        customTime.toISOString()
      )
    })
  })

  describe('context enrichment', () => {
    it('should include context object', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        context: {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          locale: 'en-US',
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as { context: AnalyticsContext }).context).toMatchObject({
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        locale: 'en-US',
      })
    })

    it('should include library info in context', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
      })

      await analytics.flush()
      expect((mockDest.events[0] as { context: AnalyticsContext }).context.library).toMatchObject({
        name: 'dotdo-analytics',
        version: expect.any(String),
      })
    })
  })

  // ==========================================================================
  // [RED] EVENT SCHEMA VALIDATION
  // ==========================================================================

  describe('event schema validation', () => {
    it('should reject event names exceeding max length (200 chars)', async () => {
      const longEventName = 'A'.repeat(201)
      await expect(
        analytics.track({
          event: longEventName,
          userId: 'user_123',
        })
      ).rejects.toThrow('event name exceeds maximum length of 200 characters')
    })

    it('should reject event names with invalid characters', async () => {
      await expect(
        analytics.track({
          event: 'Event\x00Name', // null byte
          userId: 'user_123',
        })
      ).rejects.toThrow('event name contains invalid characters')
    })

    it('should reject event names that are only whitespace', async () => {
      await expect(
        analytics.track({
          event: '   ',
          userId: 'user_123',
        })
      ).rejects.toThrow('event name is required')
    })

    it('should trim whitespace from event names', async () => {
      await analytics.track({
        event: '  Button Clicked  ',
        userId: 'user_123',
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).event).toBe('Button Clicked')
    })

    it('should validate userId format', async () => {
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: '', // empty string should fail
        })
      ).rejects.toThrow('userId or anonymousId is required')
    })

    it('should reject userId exceeding max length (256 chars)', async () => {
      const longUserId = 'U'.repeat(257)
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: longUserId,
        })
      ).rejects.toThrow('userId exceeds maximum length of 256 characters')
    })

    it('should reject anonymousId exceeding max length (256 chars)', async () => {
      const longAnonymousId = 'A'.repeat(257)
      await expect(
        analytics.track({
          event: 'Test Event',
          anonymousId: longAnonymousId,
        })
      ).rejects.toThrow('anonymousId exceeds maximum length of 256 characters')
    })

    it('should validate messageId format (UUID-like)', async () => {
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          messageId: 'not-a-valid-format!!!',
        })
      ).rejects.toThrow('messageId must be alphanumeric with hyphens')
    })
  })

  // ==========================================================================
  // [RED] REQUIRED FIELDS VALIDATION
  // ==========================================================================

  describe('required fields', () => {
    it('should reject null event name', async () => {
      await expect(
        analytics.track({
          event: null as unknown as string,
          userId: 'user_123',
        })
      ).rejects.toThrow('event name is required')
    })

    it('should reject undefined event name', async () => {
      await expect(
        analytics.track({
          event: undefined as unknown as string,
          userId: 'user_123',
        })
      ).rejects.toThrow('event name is required')
    })

    it('should reject both userId and anonymousId as empty strings', async () => {
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: '',
          anonymousId: '',
        })
      ).rejects.toThrow('userId or anonymousId is required')
    })

    it('should reject both userId and anonymousId as whitespace', async () => {
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: '   ',
          anonymousId: '   ',
        })
      ).rejects.toThrow('userId or anonymousId is required')
    })

    it('should accept valid event with only anonymousId', async () => {
      await analytics.track({
        event: 'Anonymous Action',
        anonymousId: 'anon_valid_123',
      })

      await analytics.flush()
      expect(mockDest.events).toHaveLength(1)
      expect(mockDest.events[0]).toMatchObject({
        type: 'track',
        event: 'Anonymous Action',
        anonymousId: 'anon_valid_123',
      })
    })

    it('should accept valid event with both userId and anonymousId', async () => {
      await analytics.track({
        event: 'Linked Action',
        userId: 'user_123',
        anonymousId: 'anon_456',
      })

      await analytics.flush()
      expect(mockDest.events[0]).toMatchObject({
        userId: 'user_123',
        anonymousId: 'anon_456',
      })
    })
  })

  // ==========================================================================
  // [RED] CUSTOM PROPERTIES VALIDATION
  // ==========================================================================

  describe('custom properties', () => {
    it('should support nested object properties', async () => {
      await analytics.track({
        event: 'Complex Event',
        userId: 'user_123',
        properties: {
          product: {
            id: 'prod_123',
            details: {
              category: 'Electronics',
              subcategory: 'Phones',
            },
          },
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).properties).toMatchObject({
        product: {
          id: 'prod_123',
          details: {
            category: 'Electronics',
            subcategory: 'Phones',
          },
        },
      })
    })

    it('should support array properties', async () => {
      await analytics.track({
        event: 'Cart Updated',
        userId: 'user_123',
        properties: {
          items: [
            { sku: 'SKU001', quantity: 2 },
            { sku: 'SKU002', quantity: 1 },
          ],
          tags: ['sale', 'featured', 'new'],
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).properties).toMatchObject({
        items: [
          { sku: 'SKU001', quantity: 2 },
          { sku: 'SKU002', quantity: 1 },
        ],
        tags: ['sale', 'featured', 'new'],
      })
    })

    it('should support boolean properties', async () => {
      await analytics.track({
        event: 'Feature Toggled',
        userId: 'user_123',
        properties: {
          enabled: true,
          darkMode: false,
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).properties).toMatchObject({
        enabled: true,
        darkMode: false,
      })
    })

    it('should support null property values', async () => {
      await analytics.track({
        event: 'Profile Updated',
        userId: 'user_123',
        properties: {
          middleName: null,
          nickname: 'Johnny',
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).properties).toMatchObject({
        middleName: null,
        nickname: 'Johnny',
      })
    })

    it('should support numeric property types', async () => {
      await analytics.track({
        event: 'Metrics Recorded',
        userId: 'user_123',
        properties: {
          integer: 42,
          float: 3.14159,
          negative: -100,
          zero: 0,
          largeNumber: Number.MAX_SAFE_INTEGER,
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).properties).toMatchObject({
        integer: 42,
        float: 3.14159,
        negative: -100,
        zero: 0,
        largeNumber: Number.MAX_SAFE_INTEGER,
      })
    })

    it('should reject properties exceeding max size (500KB)', async () => {
      const largeString = 'X'.repeat(600 * 1024) // 600KB
      await expect(
        analytics.track({
          event: 'Large Event',
          userId: 'user_123',
          properties: {
            data: largeString,
          },
        })
      ).rejects.toThrow('properties exceed maximum size of 500KB')
    })

    it('should reject deeply nested properties (max depth 10)', async () => {
      const deepNested = { level1: { level2: { level3: { level4: { level5: { level6: { level7: { level8: { level9: { level10: { level11: 'too deep' } } } } } } } } } } }
      await expect(
        analytics.track({
          event: 'Deep Event',
          userId: 'user_123',
          properties: deepNested,
        })
      ).rejects.toThrow('properties exceed maximum nesting depth of 10')
    })

    it('should reject circular reference in properties', async () => {
      const circular: Record<string, unknown> = { name: 'test' }
      circular.self = circular

      await expect(
        analytics.track({
          event: 'Circular Event',
          userId: 'user_123',
          properties: circular,
        })
      ).rejects.toThrow('properties contain circular reference')
    })

    it('should handle undefined property values by omitting them', async () => {
      await analytics.track({
        event: 'Sparse Event',
        userId: 'user_123',
        properties: {
          defined: 'value',
          undefined: undefined,
        },
      })

      await analytics.flush()
      const props = (mockDest.events[0] as TrackEvent).properties
      expect(props).toHaveProperty('defined', 'value')
      expect(props).not.toHaveProperty('undefined')
    })

    it('should support Date objects in properties (serialized to ISO string)', async () => {
      const testDate = new Date('2025-06-15T12:00:00Z')
      await analytics.track({
        event: 'Date Event',
        userId: 'user_123',
        properties: {
          createdAt: testDate,
        },
      })

      await analytics.flush()
      expect((mockDest.events[0] as TrackEvent).properties).toMatchObject({
        createdAt: '2025-06-15T12:00:00.000Z',
      })
    })
  })

  // ==========================================================================
  // [RED] TIMESTAMP HANDLING
  // ==========================================================================

  describe('timestamp handling', () => {
    it('should accept ISO 8601 string timestamp', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        timestamp: '2025-06-15T12:30:45.123Z',
      })

      await analytics.flush()
      expect((mockDest.events[0] as { timestamp: string }).timestamp).toBe(
        '2025-06-15T12:30:45.123Z'
      )
    })

    it('should accept ISO 8601 string with timezone offset', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        timestamp: '2025-06-15T12:30:45+05:30',
      })

      await analytics.flush()
      // Should normalize to UTC
      expect((mockDest.events[0] as { timestamp: string }).timestamp).toBe(
        '2025-06-15T07:00:45.000Z'
      )
    })

    it('should accept Unix timestamp in milliseconds', async () => {
      const unixMs = 1718452245123 // 2024-06-15T12:30:45.123Z
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        timestamp: unixMs as unknown as Date,
      })

      await analytics.flush()
      expect((mockDest.events[0] as { timestamp: string }).timestamp).toBe(
        '2024-06-15T12:30:45.123Z'
      )
    })

    it('should accept Unix timestamp in seconds', async () => {
      const unixSec = 1718452245 // 2024-06-15T12:30:45Z
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        timestamp: unixSec as unknown as Date,
      })

      await analytics.flush()
      expect((mockDest.events[0] as { timestamp: string }).timestamp).toBe(
        '2024-06-15T12:30:45.000Z'
      )
    })

    it('should reject invalid timestamp string', async () => {
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          timestamp: 'not-a-date' as unknown as Date,
        })
      ).rejects.toThrow('invalid timestamp format')
    })

    it('should reject timestamps in the far future (more than 1 hour ahead)', async () => {
      const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours ahead
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          timestamp: farFuture,
        })
      ).rejects.toThrow('timestamp cannot be more than 1 hour in the future')
    })

    it('should reject timestamps too far in the past (more than 30 days)', async () => {
      const farPast = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days ago
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          timestamp: farPast,
        })
      ).rejects.toThrow('timestamp cannot be more than 30 days in the past')
    })

    it('should preserve millisecond precision', async () => {
      const preciseDate = new Date('2025-06-15T12:30:45.999Z')
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        timestamp: preciseDate,
      })

      await analytics.flush()
      expect((mockDest.events[0] as { timestamp: string }).timestamp).toBe(
        '2025-06-15T12:30:45.999Z'
      )
    })

    it('should default to current time when timestamp is omitted', async () => {
      const before = new Date()
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
      })
      const after = new Date()

      await analytics.flush()
      const timestamp = new Date(
        (mockDest.events[0] as { timestamp: string }).timestamp
      )
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should handle timestamp at Unix epoch', async () => {
      const epoch = new Date(0) // 1970-01-01T00:00:00.000Z
      await expect(
        analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          timestamp: epoch,
        })
      ).rejects.toThrow('timestamp cannot be more than 30 days in the past')
    })
  })
})

// ============================================================================
// PAGE EVENT - PAGE VIEW TRACKING
// ============================================================================

describe('Page Event', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  it('should track page view with name', async () => {
    await analytics.page({
      userId: 'user_123',
      name: 'Home',
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      type: 'page',
      name: 'Home',
      userId: 'user_123',
    })
  })

  it('should track page view with category', async () => {
    await analytics.page({
      userId: 'user_123',
      name: 'Signup',
      category: 'Authentication',
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      name: 'Signup',
      category: 'Authentication',
    })
  })

  it('should track page view with properties', async () => {
    await analytics.page({
      userId: 'user_123',
      name: 'Product',
      properties: {
        url: 'https://example.com/product/123',
        referrer: 'https://google.com',
        title: 'Amazing Product',
        path: '/product/123',
        search: '?ref=homepage',
      },
    })

    await analytics.flush()
    expect((mockDest.events[0] as { properties: Record<string, unknown> }).properties).toMatchObject({
      url: 'https://example.com/product/123',
      referrer: 'https://google.com',
      title: 'Amazing Product',
      path: '/product/123',
      search: '?ref=homepage',
    })
  })

  it('should increment session page views', async () => {
    await analytics.page({ userId: 'user_123', name: 'Home' })
    await analytics.page({ userId: 'user_123', name: 'About' })
    await analytics.page({ userId: 'user_123', name: 'Contact' })

    const session = analytics.getSession('user_123')
    expect(session?.pageViews).toBe(3)
  })
})

// ============================================================================
// SCREEN EVENT - MOBILE SCREEN TRACKING
// ============================================================================

describe('Screen Event', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  it('should track screen view', async () => {
    await analytics.screen({
      userId: 'user_123',
      name: 'Dashboard',
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      type: 'screen',
      name: 'Dashboard',
      userId: 'user_123',
    })
  })

  it('should track screen view with properties', async () => {
    await analytics.screen({
      userId: 'user_123',
      name: 'Settings',
      properties: {
        section: 'notifications',
        previousScreen: 'Profile',
      },
    })

    await analytics.flush()
    expect((mockDest.events[0] as { properties: Record<string, unknown> }).properties).toMatchObject({
      section: 'notifications',
      previousScreen: 'Profile',
    })
  })
})

// ============================================================================
// IDENTIFY EVENT - USER IDENTIFICATION
// ============================================================================

describe('Identify Event', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  it('should identify user with traits', async () => {
    await analytics.identify({
      userId: 'user_123',
      traits: {
        email: 'user@example.com',
        name: 'John Doe',
        plan: 'premium',
      },
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      type: 'identify',
      userId: 'user_123',
      traits: {
        email: 'user@example.com',
        name: 'John Doe',
        plan: 'premium',
      },
    })
  })

  it('should identify anonymous user', async () => {
    await analytics.identify({
      anonymousId: 'anon_456',
      traits: {
        referrer: 'https://google.com',
      },
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      type: 'identify',
      anonymousId: 'anon_456',
    })
  })

  it('should merge traits with existing user profile', async () => {
    await analytics.identify({
      userId: 'user_123',
      traits: { email: 'user@example.com' },
    })
    await analytics.identify({
      userId: 'user_123',
      traits: { plan: 'enterprise' },
    })

    const identity = analytics.getIdentity('user_123')
    expect(identity?.traits).toMatchObject({
      email: 'user@example.com',
      plan: 'enterprise',
    })
  })

  it('should link anonymous to user on identify', async () => {
    // First, track as anonymous
    await analytics.track({
      event: 'Page Viewed',
      anonymousId: 'anon_456',
    })

    // Then identify with userId
    await analytics.identify({
      userId: 'user_123',
      anonymousId: 'anon_456',
      traits: { email: 'user@example.com' },
    })

    const identity = analytics.getIdentity('user_123')
    expect(identity?.anonymousIds).toContain('anon_456')
  })
})

// ============================================================================
// GROUP EVENT - USER GROUPING
// ============================================================================

describe('Group Event', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  it('should group user with organization', async () => {
    await analytics.group({
      userId: 'user_123',
      groupId: 'org_456',
      traits: {
        name: 'Acme Corp',
        industry: 'Technology',
        employees: 500,
      },
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      type: 'group',
      userId: 'user_123',
      groupId: 'org_456',
      traits: {
        name: 'Acme Corp',
        industry: 'Technology',
        employees: 500,
      },
    })
  })

  it('should require groupId', async () => {
    await expect(
      analytics.group({
        userId: 'user_123',
        groupId: '',
      } as GroupEvent)
    ).rejects.toThrow('groupId is required')
  })
})

// ============================================================================
// ALIAS EVENT - IDENTITY MERGING
// ============================================================================

describe('Alias Event', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  it('should alias previous to new id', async () => {
    await analytics.alias({
      previousId: 'anon_456',
      userId: 'user_123',
    })

    await analytics.flush()
    expect(mockDest.events[0]).toMatchObject({
      type: 'alias',
      previousId: 'anon_456',
      userId: 'user_123',
    })
  })

  it('should require previousId', async () => {
    await expect(
      analytics.alias({
        previousId: '',
        userId: 'user_123',
      })
    ).rejects.toThrow('previousId is required')
  })

  it('should require userId', async () => {
    await expect(
      analytics.alias({
        previousId: 'anon_456',
        userId: '',
      })
    ).rejects.toThrow('userId is required')
  })

  it('should merge identities after alias', async () => {
    // Track as anonymous
    await analytics.identify({
      anonymousId: 'anon_456',
      traits: { referrer: 'google.com' },
    })

    // Alias to user
    await analytics.alias({
      previousId: 'anon_456',
      userId: 'user_123',
    })

    const identity = analytics.getIdentity('user_123')
    expect(identity?.traits).toMatchObject({ referrer: 'google.com' })
  })
})

// ============================================================================
// SESSION TRACKING
// ============================================================================

describe('Session Tracking', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 100,
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  describe('session creation', () => {
    it('should create session on first event', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
      })

      const session = analytics.getSession('user_123')
      expect(session).toBeDefined()
      expect(session?.id).toMatch(/^sess_/)
      expect(session?.startedAt).toBeInstanceOf(Date)
    })

    it('should reuse session for same user', async () => {
      await analytics.track({ event: 'Event 1', userId: 'user_123' })
      const session1 = analytics.getSession('user_123')

      await analytics.track({ event: 'Event 2', userId: 'user_123' })
      const session2 = analytics.getSession('user_123')

      expect(session1?.id).toBe(session2?.id)
    })

    it('should track page views in session', async () => {
      await analytics.page({ userId: 'user_123', name: 'Home' })
      await analytics.page({ userId: 'user_123', name: 'About' })

      const session = analytics.getSession('user_123')
      expect(session?.pageViews).toBe(2)
    })

    it('should track events in session', async () => {
      await analytics.track({ event: 'Event 1', userId: 'user_123' })
      await analytics.track({ event: 'Event 2', userId: 'user_123' })
      await analytics.track({ event: 'Event 3', userId: 'user_123' })

      const session = analytics.getSession('user_123')
      expect(session?.events).toBe(3)
    })
  })

  describe('session timeout', () => {
    it('should expire session after timeout', async () => {
      vi.useFakeTimers()

      await analytics.track({ event: 'Event 1', userId: 'user_123' })
      const session1 = analytics.getSession('user_123')

      // Advance time past session timeout
      vi.advanceTimersByTime(31 * 60 * 1000)

      await analytics.track({ event: 'Event 2', userId: 'user_123' })
      const session2 = analytics.getSession('user_123')

      expect(session1?.id).not.toBe(session2?.id)

      vi.useRealTimers()
    })

    it('should update lastActivity on each event', async () => {
      vi.useFakeTimers()

      await analytics.track({ event: 'Event 1', userId: 'user_123' })
      const time1 = analytics.getSession('user_123')?.lastActivity

      vi.advanceTimersByTime(5000)

      await analytics.track({ event: 'Event 2', userId: 'user_123' })
      const time2 = analytics.getSession('user_123')?.lastActivity

      expect(time2!.getTime()).toBeGreaterThan(time1!.getTime())

      vi.useRealTimers()
    })
  })

  describe('device detection', () => {
    it('should detect device info from user agent', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        context: {
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        },
      })

      const session = analytics.getSession('user_123')
      expect(session?.device).toMatchObject({
        type: 'mobile',
        manufacturer: 'Apple',
        model: 'iPhone',
      })
    })

    it('should detect browser info', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        context: {
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124',
        },
      })

      const session = analytics.getSession('user_123')
      expect(session?.browser).toMatchObject({
        name: 'Chrome',
        version: expect.any(String),
      })
    })

    it('should detect OS info', async () => {
      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        context: {
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      })

      const session = analytics.getSession('user_123')
      expect(session?.os).toMatchObject({
        name: 'macOS',
        version: expect.any(String),
      })
    })
  })

  describe('referrer tracking', () => {
    it('should track initial referrer', async () => {
      await analytics.page({
        userId: 'user_123',
        name: 'Landing',
        properties: {
          referrer: 'https://google.com/search?q=example',
        },
      })

      const session = analytics.getSession('user_123')
      expect(session?.referrer).toMatchObject({
        url: 'https://google.com/search?q=example',
        source: 'google',
        medium: 'organic',
      })
    })

    it('should track UTM parameters', async () => {
      await analytics.page({
        userId: 'user_123',
        name: 'Landing',
        properties: {
          url: 'https://example.com/?utm_source=twitter&utm_medium=social&utm_campaign=launch',
        },
      })

      const session = analytics.getSession('user_123')
      expect(session?.campaign).toMatchObject({
        source: 'twitter',
        medium: 'social',
        name: 'launch',
      })
    })
  })
})

// ============================================================================
// BATCHING AND FLUSHING
// ============================================================================

describe('Batching', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
  })

  afterEach(async () => {
    await analytics?.close()
  })

  describe('batch size', () => {
    it('should flush when batch size reached', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 5,
        flushInterval: 60000, // Long interval
      })

      // Send 5 events
      for (let i = 0; i < 5; i++) {
        await analytics.track({
          event: `Event ${i}`,
          userId: 'user_123',
        })
      }

      // Should have auto-flushed
      expect(mockDest.events).toHaveLength(5)
    })

    it('should not flush before batch size', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 10,
        flushInterval: 60000,
      })

      // Send 3 events
      for (let i = 0; i < 3; i++) {
        await analytics.track({
          event: `Event ${i}`,
          userId: 'user_123',
        })
      }

      // Should not have flushed yet
      expect(mockDest.events).toHaveLength(0)
    })
  })

  describe('flush interval', () => {
    it('should flush after interval', async () => {
      vi.useFakeTimers()

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        flushInterval: 1000,
      })

      await analytics.track({ event: 'Test', userId: 'user_123' })
      expect(mockDest.events).toHaveLength(0)

      vi.advanceTimersByTime(1100)
      await Promise.resolve() // Allow flush to complete

      expect(mockDest.events).toHaveLength(1)

      vi.useRealTimers()
    })
  })

  describe('manual flush', () => {
    it('should flush on demand', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        flushInterval: 60000,
      })

      await analytics.track({ event: 'Test 1', userId: 'user_123' })
      await analytics.track({ event: 'Test 2', userId: 'user_123' })

      expect(mockDest.events).toHaveLength(0)

      await analytics.flush()

      expect(mockDest.events).toHaveLength(2)
    })

    it('should return batch result', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
      })

      await analytics.track({ event: 'Test 1', userId: 'user_123' })
      await analytics.track({ event: 'Test 2', userId: 'user_123' })

      const result = await analytics.flush()

      expect(result).toMatchObject({
        success: true,
        count: 2,
      })
    })

    it('should handle empty queue', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
      })

      const result = await analytics.flush()

      expect(result).toMatchObject({
        success: true,
        count: 0,
      })
    })
  })

  describe('queue management', () => {
    it('should respect maxQueueSize', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        flushInterval: 60000,
        maxQueueSize: 5,
      })

      // Try to queue 10 events
      for (let i = 0; i < 10; i++) {
        await analytics.track({
          event: `Event ${i}`,
          userId: 'user_123',
        })
      }

      // Queue should be capped at 5, older events dropped
      await analytics.flush()
      expect(mockDest.events).toHaveLength(5)
    })

    it('should report queue size', async () => {
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
      })

      expect(analytics.queueSize).toBe(0)

      await analytics.track({ event: 'Test 1', userId: 'user_123' })
      expect(analytics.queueSize).toBe(1)

      await analytics.track({ event: 'Test 2', userId: 'user_123' })
      expect(analytics.queueSize).toBe(2)

      await analytics.flush()
      expect(analytics.queueSize).toBe(0)
    })
  })
})

// ============================================================================
// CLOSE AND CLEANUP
// ============================================================================

describe('Close and Cleanup', () => {
  it('should flush pending events on close', async () => {
    const mockDest = createMockDestination()
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 100,
      flushInterval: 60000,
    })

    await analytics.track({ event: 'Test 1', userId: 'user_123' })
    await analytics.track({ event: 'Test 2', userId: 'user_123' })

    await analytics.close()

    expect(mockDest.events).toHaveLength(2)
  })

  it('should reject new events after close', async () => {
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
    })

    await analytics.close()

    await expect(
      analytics.track({ event: 'Test', userId: 'user_123' })
    ).rejects.toThrow('Analytics is closed')
  })

  it('should clear intervals on close', async () => {
    vi.useFakeTimers()

    const mockDest = createMockDestination()
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushInterval: 1000,
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.close()

    // Advance time - should not trigger any more flushes
    vi.advanceTimersByTime(5000)

    // Only 1 event from close() flush, not additional interval flushes
    expect(mockDest.events).toHaveLength(1)

    vi.useRealTimers()
  })
})

// ============================================================================
// DEDUPLICATION
// ============================================================================

describe('Deduplication', () => {
  let analytics: AnalyticsCollector
  let mockDest: Destination & { events: unknown[] }

  beforeEach(() => {
    mockDest = createMockDestination()
    analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 100,
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  it('should deduplicate by messageId', async () => {
    await analytics.track({
      event: 'Test',
      userId: 'user_123',
      messageId: 'msg_1',
    })
    await analytics.track({
      event: 'Test',
      userId: 'user_123',
      messageId: 'msg_1', // Duplicate
    })
    await analytics.track({
      event: 'Test',
      userId: 'user_123',
      messageId: 'msg_2', // Different
    })

    await analytics.flush()

    expect(mockDest.events).toHaveLength(2)
    expect((mockDest.events[0] as { messageId: string }).messageId).toBe('msg_1')
    expect((mockDest.events[1] as { messageId: string }).messageId).toBe('msg_2')
  })

  it('should expire dedup cache after window', async () => {
    vi.useFakeTimers()

    const analytics2 = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 100,
      dedupWindow: 1000, // 1 second dedup window
    })

    await analytics2.track({
      event: 'Test',
      userId: 'user_123',
      messageId: 'msg_1',
    })

    vi.advanceTimersByTime(2000) // Past dedup window

    await analytics2.track({
      event: 'Test',
      userId: 'user_123',
      messageId: 'msg_1', // Same messageId, but past window
    })

    await analytics2.flush()

    expect(mockDest.events).toHaveLength(2)

    await analytics2.close()
    vi.useRealTimers()
  })
})

// ============================================================================
// RETRY LOGIC
// ============================================================================

describe('Retry Logic', () => {
  it('should retry failed sends', async () => {
    let attempts = 0
    const failingDest: Destination = {
      name: 'failing',
      send: async (batch) => {
        attempts++
        if (attempts < 3) {
          throw new Error('Network error')
        }
        return { success: true, count: batch.length }
      },
    }

    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [failingDest],
      retries: 3,
      retryDelay: 10,
      flushAt: 1,
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.flush()

    expect(attempts).toBe(3)
    await analytics.close()
  })

  it('should fail after max retries', async () => {
    const failingDest: Destination = {
      name: 'always-failing',
      send: async () => {
        throw new Error('Permanent error')
      },
    }

    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [failingDest],
      retries: 2,
      retryDelay: 10,
      flushAt: 1,
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    const result = await analytics.flush()

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()

    await analytics.close()
  })

  it('should use exponential backoff', async () => {
    const delays: number[] = []
    let lastTime = Date.now()

    const failingDest: Destination = {
      name: 'failing',
      send: async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Network error')
      },
    }

    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [failingDest],
      retries: 4,
      retryDelay: 100,
      retryBackoff: 'exponential',
      flushAt: 1,
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.flush()

    // First call immediate, then 100ms, 200ms, 400ms
    expect(delays[1]).toBeGreaterThanOrEqual(90)
    expect(delays[2]).toBeGreaterThanOrEqual(180)
    expect(delays[3]).toBeGreaterThanOrEqual(360)

    await analytics.close()
  })
})

// ============================================================================
// MULTIPLE DESTINATIONS
// ============================================================================

describe('Multiple Destinations', () => {
  it('should send to all destinations', async () => {
    const dest1 = createMockDestination()
    const dest2 = createMockDestination()

    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [dest1, dest2],
      flushAt: 1,
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.flush()

    expect(dest1.events).toHaveLength(1)
    expect(dest2.events).toHaveLength(1)

    await analytics.close()
  })

  it('should continue if one destination fails', async () => {
    const dest1 = createMockDestination()
    const failingDest: Destination = {
      name: 'failing',
      send: async () => {
        throw new Error('Destination error')
      },
    }

    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [failingDest, dest1],
      flushAt: 1,
      retries: 0,
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    const result = await analytics.flush()

    // dest1 should still receive events
    expect(dest1.events).toHaveLength(1)
    // Result should indicate partial success
    expect(result.destinations?.['mock']?.success).toBe(true)
    expect(result.destinations?.['failing']?.success).toBe(false)

    await analytics.close()
  })
})

// ============================================================================
// INTEGRATIONS
// ============================================================================

describe('Integrations', () => {
  it('should support per-event integration settings', async () => {
    const mockDest = createMockDestination()
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
    })

    await analytics.track({
      event: 'Test',
      userId: 'user_123',
      integrations: {
        All: true,
        Amplitude: false, // Disable for Amplitude
        Mixpanel: { apiKey: 'custom-key' }, // Custom settings
      },
    })

    await analytics.flush()
    expect((mockDest.events[0] as { integrations: Record<string, unknown> }).integrations).toMatchObject({
      All: true,
      Amplitude: false,
      Mixpanel: { apiKey: 'custom-key' },
    })

    await analytics.close()
  })
})

// ============================================================================
// MIDDLEWARE
// ============================================================================

describe('Middleware', () => {
  it('should support event middleware', async () => {
    const mockDest = createMockDestination()
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
      middleware: [
        (event) => ({
          ...event,
          properties: {
            ...event.properties,
            enriched: true,
          },
        }),
      ],
    })

    await analytics.track({
      event: 'Test',
      userId: 'user_123',
      properties: { original: true },
    })

    await analytics.flush()
    expect((mockDest.events[0] as { properties: Record<string, unknown> }).properties).toMatchObject({
      original: true,
      enriched: true,
    })

    await analytics.close()
  })

  it('should allow middleware to drop events', async () => {
    const mockDest = createMockDestination()
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
      middleware: [
        (event) => {
          if ((event as TrackEvent).event === 'Sensitive') {
            return null // Drop event
          }
          return event
        },
      ],
    })

    await analytics.track({ event: 'Normal', userId: 'user_123' })
    await analytics.track({ event: 'Sensitive', userId: 'user_123' })
    await analytics.track({ event: 'Another', userId: 'user_123' })

    await analytics.flush()
    expect(mockDest.events).toHaveLength(2)
    expect(mockDest.events.map((e) => (e as TrackEvent).event)).toEqual([
      'Normal',
      'Another',
    ])

    await analytics.close()
  })

  it('should chain multiple middleware', async () => {
    const mockDest = createMockDestination()
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [mockDest],
      flushAt: 1,
      middleware: [
        (event) => ({ ...event, step1: true }),
        (event) => ({ ...event, step2: true }),
        (event) => ({ ...event, step3: true }),
      ],
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.flush()

    expect(mockDest.events[0]).toMatchObject({
      step1: true,
      step2: true,
      step3: true,
    })

    await analytics.close()
  })
})

// ============================================================================
// CALLBACKS
// ============================================================================

describe('Callbacks', () => {
  it('should call onTrack callback', async () => {
    const tracked: unknown[] = []
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      flushAt: 100,
      onTrack: (event) => tracked.push(event),
    })

    await analytics.track({ event: 'Test 1', userId: 'user_123' })
    await analytics.track({ event: 'Test 2', userId: 'user_456' })

    expect(tracked).toHaveLength(2)
    expect((tracked[0] as TrackEvent).event).toBe('Test 1')

    await analytics.close()
  })

  it('should call onFlush callback', async () => {
    let flushResult: BatchResult | undefined
    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      flushAt: 100,
      onFlush: (result) => {
        flushResult = result
      },
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.flush()

    expect(flushResult).toBeDefined()
    expect(flushResult?.count).toBe(1)

    await analytics.close()
  })

  it('should call onError callback', async () => {
    const errors: Error[] = []
    const failingDest: Destination = {
      name: 'failing',
      send: async () => {
        throw new Error('Send failed')
      },
    }

    const analytics = createAnalyticsCollector({
      writeKey: 'test-key',
      destinations: [failingDest],
      retries: 0,
      flushAt: 1,
      onError: (error) => errors.push(error),
    })

    await analytics.track({ event: 'Test', userId: 'user_123' })
    await analytics.flush()

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Send failed')

    await analytics.close()
  })
})
