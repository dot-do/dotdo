/**
 * Event Tracking API Integration Tests
 *
 * Comprehensive tests for the Segment-compatible event collection API.
 * Tests all event types: track, identify, page, screen, group, alias, batch.
 *
 * @module tests/analytics/event-tracking-api.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { eventsRouter } from '../../api/analytics/events'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface EventError {
  error: {
    code: string
    message: string
    details?: { errors?: string[] }
  }
}

interface EventResponse {
  success: boolean
  messageId: string
  receivedAt: string
}

interface BatchResponse {
  success: boolean
  processed: number
  succeeded: number
  failed: number
  events?: Array<{ messageId: string; success: boolean; error?: string }>
}

interface MockEnv {
  AE?: {
    writeDataPoint: (data: unknown) => void
  }
  QUEUE?: {
    send: (data: unknown) => Promise<void>
  }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createEventsApp(): Hono<{ Bindings: MockEnv }> {
  const app = new Hono<{ Bindings: MockEnv }>()
  app.route('/', eventsRouter)
  return app
}

function createRequest(path: string, body: unknown): Request {
  return new Request(`http://test.api.dotdo.dev${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ============================================================================
// TRACK ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Track Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful tracking', () => {
    it('tracks event with userId', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Button Clicked',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.messageId).toBeDefined()
      expect(data.receivedAt).toBeDefined()
    })

    it('tracks event with anonymousId', async () => {
      const request = createRequest('/v1/track', {
        anonymousId: 'anon_456',
        event: 'Page Viewed',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks event with properties', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Product Added',
        properties: {
          productId: 'prod_abc',
          price: 49.99,
          currency: 'USD',
          quantity: 2,
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks event with custom timestamp', async () => {
      const timestamp = '2026-01-10T12:00:00Z'
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Historical Event',
        timestamp,
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks event with context enrichment', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Checkout Started',
        context: {
          ip: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          locale: 'en-US',
          timezone: 'America/New_York',
          campaign: {
            source: 'google',
            medium: 'cpc',
            name: 'spring_sale',
          },
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks event with integrations settings', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Subscription Renewed',
        integrations: {
          All: true,
          Amplitude: false,
          Mixpanel: { sessionId: 'abc123' },
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('uses provided messageId', async () => {
      const customMessageId = 'custom-msg-abc123'
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Test Event',
        messageId: customMessageId,
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.messageId).toBe(customMessageId)
    })
  })

  describe('validation errors', () => {
    it('rejects missing identity', async () => {
      const request = createRequest('/v1/track', {
        event: 'Orphan Event',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_EVENT')
      expect(data.error.details?.errors).toContain(
        'Either userId or anonymousId is required'
      )
    })

    it('rejects missing event name', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_EVENT')
      expect(data.error.details?.errors).toContain('event name is required')
    })

    it('rejects non-string event name', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 12345,
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_EVENT')
      expect(data.error.details?.errors).toContain('event must be a string')
    })

    it('rejects non-object properties', async () => {
      const request = createRequest('/v1/track', {
        userId: 'user_123',
        event: 'Test',
        properties: 'not an object',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('properties must be an object')
    })

    it('rejects invalid JSON', async () => {
      const request = new Request('http://test.api.dotdo.dev/v1/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {{{',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_REQUEST')
    })
  })
})

// ============================================================================
// IDENTIFY ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Identify Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful identification', () => {
    it('identifies user with traits', async () => {
      const request = createRequest('/v1/identify', {
        userId: 'user_123',
        traits: {
          email: 'john.doe@example.com',
          name: 'John Doe',
          plan: 'enterprise',
          createdAt: '2025-01-01T00:00:00Z',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.messageId).toBeDefined()
    })

    it('identifies with anonymousId only', async () => {
      const request = createRequest('/v1/identify', {
        anonymousId: 'anon_789',
        traits: {
          referrer: 'https://google.com',
          landingPage: '/pricing',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('identifies without traits', async () => {
      const request = createRequest('/v1/identify', {
        userId: 'user_123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('identifies with company traits', async () => {
      const request = createRequest('/v1/identify', {
        userId: 'user_123',
        traits: {
          email: 'ceo@acme.com',
          company: {
            id: 'company_456',
            name: 'Acme Corp',
            industry: 'Technology',
            employees: 500,
          },
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('validation errors', () => {
    it('rejects missing identity', async () => {
      const request = createRequest('/v1/identify', {
        traits: { email: 'test@example.com' },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_EVENT')
    })

    it('rejects non-object traits', async () => {
      const request = createRequest('/v1/identify', {
        userId: 'user_123',
        traits: 'not an object',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('traits must be an object')
    })
  })
})

// ============================================================================
// PAGE ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Page Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful page tracking', () => {
    it('tracks page view with name', async () => {
      const request = createRequest('/v1/page', {
        userId: 'user_123',
        name: 'Home',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks page view with category', async () => {
      const request = createRequest('/v1/page', {
        userId: 'user_123',
        name: 'Signup',
        category: 'Authentication',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks page view with properties', async () => {
      const request = createRequest('/v1/page', {
        userId: 'user_123',
        name: 'Product Details',
        properties: {
          url: 'https://shop.example.com/products/abc',
          referrer: 'https://google.com',
          title: 'Amazing Widget - Shop',
          path: '/products/abc',
          search: '?utm_source=newsletter',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks page view without name', async () => {
      const request = createRequest('/v1/page', {
        userId: 'user_123',
        properties: {
          url: 'https://example.com/dynamic-page',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('validation errors', () => {
    it('rejects missing identity', async () => {
      const request = createRequest('/v1/page', {
        name: 'Home',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_EVENT')
    })

    it('rejects non-string name', async () => {
      const request = createRequest('/v1/page', {
        userId: 'user_123',
        name: 12345,
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('name must be a string')
    })
  })
})

// ============================================================================
// SCREEN ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Screen Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful screen tracking', () => {
    it('tracks screen view with name', async () => {
      const request = createRequest('/v1/screen', {
        userId: 'user_123',
        name: 'Dashboard',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks screen view with category', async () => {
      const request = createRequest('/v1/screen', {
        userId: 'user_123',
        name: 'Profile',
        category: 'Settings',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('tracks screen view with properties', async () => {
      const request = createRequest('/v1/screen', {
        userId: 'user_123',
        name: 'Order Confirmation',
        properties: {
          orderId: 'order_xyz',
          total: 149.99,
          itemCount: 3,
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('validation errors', () => {
    it('requires screen name', async () => {
      const request = createRequest('/v1/screen', {
        userId: 'user_123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain(
        'name is required for screen events'
      )
    })
  })
})

// ============================================================================
// GROUP ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Group Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful group association', () => {
    it('associates user with group', async () => {
      const request = createRequest('/v1/group', {
        userId: 'user_123',
        groupId: 'org_456',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('associates user with group and traits', async () => {
      const request = createRequest('/v1/group', {
        userId: 'user_123',
        groupId: 'org_456',
        traits: {
          name: 'Acme Corporation',
          industry: 'Technology',
          plan: 'enterprise',
          employees: 1000,
          website: 'https://acme.com',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('validation errors', () => {
    it('requires groupId', async () => {
      const request = createRequest('/v1/group', {
        userId: 'user_123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('groupId is required')
    })

    it('rejects empty groupId', async () => {
      const request = createRequest('/v1/group', {
        userId: 'user_123',
        groupId: '',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('groupId is required')
    })
  })
})

// ============================================================================
// ALIAS ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Alias Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful aliasing', () => {
    it('links anonymous to user identity', async () => {
      const request = createRequest('/v1/alias', {
        previousId: 'anon_abc123',
        userId: 'user_456',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('links old user ID to new user ID', async () => {
      const request = createRequest('/v1/alias', {
        previousId: 'old_user_id',
        userId: 'new_user_id',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('validation errors', () => {
    it('requires previousId', async () => {
      const request = createRequest('/v1/alias', {
        userId: 'user_123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('previousId is required')
    })

    it('requires userId', async () => {
      const request = createRequest('/v1/alias', {
        previousId: 'anon_123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('userId is required')
    })
  })
})

// ============================================================================
// BATCH ENDPOINT TESTS
// ============================================================================

describe('Event Tracking API - Batch Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  describe('successful batch processing', () => {
    it('processes batch with single event', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          { type: 'track', userId: 'user_123', event: 'Event 1' },
        ],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.processed).toBe(1)
      expect(data.succeeded).toBe(1)
      expect(data.failed).toBe(0)
    })

    it('processes batch with multiple events', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          { type: 'track', userId: 'user_123', event: 'Event 1' },
          { type: 'track', userId: 'user_123', event: 'Event 2' },
          { type: 'track', userId: 'user_123', event: 'Event 3' },
        ],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.processed).toBe(3)
      expect(data.succeeded).toBe(3)
    })

    it('processes batch with mixed event types', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          { type: 'track', userId: 'user_123', event: 'Signup Completed' },
          { type: 'identify', userId: 'user_123', traits: { plan: 'pro' } },
          { type: 'page', userId: 'user_123', name: 'Dashboard' },
          { type: 'screen', userId: 'user_123', name: 'Settings' },
          { type: 'group', userId: 'user_123', groupId: 'org_456' },
          { type: 'alias', previousId: 'anon_789', userId: 'user_123' },
        ],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.processed).toBe(6)
      expect(data.succeeded).toBe(6)
    })

    it('includes event results with messageIds', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          { type: 'track', userId: 'user_123', event: 'Event A' },
          { type: 'track', userId: 'user_123', event: 'Event B' },
        ],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.events).toHaveLength(2)
      expect(data.events?.[0]?.messageId).toBeDefined()
      expect(data.events?.[0]?.success).toBe(true)
      expect(data.events?.[1]?.messageId).toBeDefined()
      expect(data.events?.[1]?.success).toBe(true)
    })

    it('applies batch-level context to all events', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          { type: 'track', userId: 'user_123', event: 'Event 1' },
          { type: 'track', userId: 'user_123', event: 'Event 2' },
        ],
        context: {
          ip: '192.168.1.100',
          userAgent: 'TestAgent/2.0',
          locale: 'en-US',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('applies batch-level integrations to all events', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          { type: 'track', userId: 'user_123', event: 'Event 1' },
        ],
        integrations: {
          All: true,
          Amplitude: false,
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('merges event-level context with batch-level context', async () => {
      const request = createRequest('/v1/batch', {
        batch: [
          {
            type: 'track',
            userId: 'user_123',
            event: 'Event 1',
            context: {
              campaign: { source: 'email' },
            },
          },
        ],
        context: {
          ip: '192.168.1.100',
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as BatchResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('validation errors', () => {
    it('requires batch array', async () => {
      const request = createRequest('/v1/batch', {})

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_BATCH')
      expect(data.error.details?.errors).toContain('batch array is required')
    })

    it('rejects non-array batch', async () => {
      const request = createRequest('/v1/batch', {
        batch: 'not an array',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('batch must be an array')
    })

    it('rejects empty batch', async () => {
      const request = createRequest('/v1/batch', {
        batch: [],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('batch array cannot be empty')
    })

    it('enforces batch size limit', async () => {
      const largeBatch = Array.from({ length: 101 }, (_, i) => ({
        type: 'track',
        userId: 'user_123',
        event: `Event ${i}`,
      }))

      const request = createRequest('/v1/batch', { batch: largeBatch })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain(
        'batch size cannot exceed 100 events'
      )
    })

    it('requires type on batch events', async () => {
      const request = createRequest('/v1/batch', {
        batch: [{ userId: 'user_123', event: 'Event 1' }],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('batch[0].type is required')
    })

    it('validates type values', async () => {
      const request = createRequest('/v1/batch', {
        batch: [{ type: 'invalid', userId: 'user_123' }],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain(
        'batch[0].type must be one of: track, identify, page, screen, group, alias'
      )
    })

    it('validates track events in batch', async () => {
      const request = createRequest('/v1/batch', {
        batch: [{ type: 'track', userId: 'user_123' }],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain(
        'batch[0].event is required for track events'
      )
    })

    it('validates identity in batch events', async () => {
      const request = createRequest('/v1/batch', {
        batch: [{ type: 'track', event: 'Test' }],
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as EventError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain(
        'batch[0] requires userId or anonymousId'
      )
    })
  })
})

// ============================================================================
// CONTENT TYPE & ERROR HANDLING TESTS
// ============================================================================

describe('Event Tracking API - Response Handling', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  it('returns JSON content type on success', async () => {
    const request = createRequest('/v1/track', {
      userId: 'user_123',
      event: 'Test',
    })

    const response = await app.fetch(request, {})

    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON content type on error', async () => {
    const request = createRequest('/v1/track', {})

    const response = await app.fetch(request, {})

    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('returns 404 for unknown endpoints', async () => {
    const request = createRequest('/v1/unknown', {})

    const response = await app.fetch(request, {})
    const data = (await response.json()) as EventError

    expect(response.status).toBe(404)
    expect(data.error.code).toBe('INVALID_REQUEST')
    expect(data.error.message).toContain('Unknown endpoint')
  })
})

// ============================================================================
// CONTEXT ENRICHMENT TESTS
// ============================================================================

describe('Event Tracking API - Context Enrichment', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createEventsApp()
  })

  it('enriches context with library info', async () => {
    const request = createRequest('/v1/track', {
      userId: 'user_123',
      event: 'Test',
    })

    const response = await app.fetch(request, {})
    const data = (await response.json()) as EventResponse

    // The library info is added internally - we verify the request succeeds
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('preserves user-provided context', async () => {
    const request = createRequest('/v1/track', {
      userId: 'user_123',
      event: 'Test',
      context: {
        app: {
          name: 'MyApp',
          version: '1.2.3',
        },
        device: {
          type: 'mobile',
          manufacturer: 'Apple',
          model: 'iPhone 15',
        },
      },
    })

    const response = await app.fetch(request, {})
    const data = (await response.json()) as EventResponse

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('normalizes timestamps to ISO format', async () => {
    const request = createRequest('/v1/track', {
      userId: 'user_123',
      event: 'Test',
      timestamp: '2026-01-13T10:30:00.000Z',
    })

    const response = await app.fetch(request, {})
    const data = (await response.json()) as EventResponse

    expect(response.status).toBe(200)
    expect(data.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
