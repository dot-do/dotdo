/**
 * Platform Event Store Tests
 *
 * Tests for the unified platform event model and store implementation.
 *
 * @module db/primitives/platform-event-store/tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  type PlatformEvent,
  type PlatformEventInput,
  createPlatformEvent,
  generateEventId,
  validatePlatformEvent,
  PLATFORM_EVENT_SCHEMA_VERSION,
} from '../../../../types/platform-event'
import {
  trackEvent,
  meterEvent,
  governEvent,
  auditEvent,
} from '../index'

// =============================================================================
// SCHEMA VALIDATION TESTS
// =============================================================================

describe('PlatformEvent Schema', () => {
  describe('generateEventId', () => {
    it('generates unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateEventId())
      }
      expect(ids.size).toBe(100)
    })

    it('generates IDs with evt_ prefix', () => {
      const id = generateEventId()
      expect(id.startsWith('evt_')).toBe(true)
    })
  })

  describe('createPlatformEvent', () => {
    const context = {
      ns: 'https://api.dotdo.dev/test',
      doId: 'do-123',
      doClass: 'TestDO',
      colo: 'SFO',
      orgId: 'org-456',
    }

    it('creates a track event', () => {
      const input: PlatformEventInput = {
        category: 'track',
        type: 'PageView',
        actor: 'user-123',
        data: { path: '/home' },
        sessionId: 'sess-abc',
      }

      const event = createPlatformEvent(input, context)

      expect(event.id).toBeDefined()
      expect(event.category).toBe('track')
      expect(event.type).toBe('PageView')
      expect(event.actor).toBe('user-123')
      expect(event.actorType).toBe('human')
      expect(event.data).toEqual({ path: '/home' })
      expect(event.sessionId).toBe('sess-abc')
      expect(event.ns).toBe('https://api.dotdo.dev/test')
      expect(event.doId).toBe('do-123')
      expect(event.doClass).toBe('TestDO')
      expect(event.colo).toBe('SFO')
      expect(event.orgId).toBe('org-456')
      expect(event.schemaVersion).toBe(PLATFORM_EVENT_SCHEMA_VERSION)
      expect(event.timestamp).toBeDefined()
      expect(event.recordedAt).toBeDefined()
    })

    it('creates a meter event', () => {
      const input: PlatformEventInput = {
        category: 'meter',
        type: 'api.tokens',
        customerId: 'cust-789',
        value: 1500,
        unit: 'tokens',
        dimensions: { model: 'gpt-4', region: 'us-east' },
      }

      const event = createPlatformEvent(input, context)

      expect(event.category).toBe('meter')
      expect(event.type).toBe('api.tokens')
      expect(event.customerId).toBe('cust-789')
      expect(event.value).toBe(1500)
      expect(event.unit).toBe('tokens')
      expect(event.dimensions).toEqual({ model: 'gpt-4', region: 'us-east' })
      expect(event.actorType).toBe('system')
      expect(event.idempotencyKey).toBeDefined() // Auto-generated
    })

    it('creates a govern event', () => {
      const input: PlatformEventInput = {
        category: 'govern',
        type: 'api.request',
        actor: 'user-123',
        apiKeyId: 'key-abc',
        requestPath: '/v1/completions',
        httpMethod: 'POST',
        statusCode: 200,
        duration: 150,
      }

      const event = createPlatformEvent(input, context)

      expect(event.category).toBe('govern')
      expect(event.type).toBe('api.request')
      expect(event.apiKeyId).toBe('key-abc')
      expect(event.requestPath).toBe('/v1/completions')
      expect(event.httpMethod).toBe('POST')
      expect(event.statusCode).toBe(200)
      expect(event.duration).toBe(150)
      expect(event.actorType).toBe('api_key')
    })

    it('creates an audit event', () => {
      const input: PlatformEventInput = {
        category: 'audit',
        type: 'entity.updated',
        actor: 'admin-123',
        object: 'customer-456',
        objectType: 'Customer',
        reason: 'Manual update by admin',
        data: { previousValue: 'old', newValue: 'new' },
      }

      const event = createPlatformEvent(input, context)

      expect(event.category).toBe('audit')
      expect(event.type).toBe('entity.updated')
      expect(event.actor).toBe('admin-123')
      expect(event.object).toBe('customer-456')
      expect(event.objectType).toBe('Customer')
      expect(event.reason).toBe('Manual update by admin')
      expect(event.data).toEqual({ previousValue: 'old', newValue: 'new' })
    })

    it('creates a system event', () => {
      const input: PlatformEventInput = {
        category: 'system',
        type: 'do.alarm',
      }

      const event = createPlatformEvent(input, context)

      expect(event.category).toBe('system')
      expect(event.type).toBe('do.alarm')
      expect(event.actorType).toBe('system')
    })

    it('sets timestamps correctly', () => {
      const before = Date.now()

      const event = createPlatformEvent(
        {
          category: 'track',
          type: 'Test',
          actor: 'user-1',
        },
        context
      )

      const after = Date.now()

      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)
      expect(event.recordedAt).toBe(event.timestamp)
    })
  })

  describe('validatePlatformEvent', () => {
    const validEvent: PlatformEvent = {
      id: 'evt_test123',
      category: 'track',
      type: 'PageView',
      actor: 'user-123',
      actorType: 'human',
      data: { path: '/home' },
      timestamp: Date.now(),
      recordedAt: Date.now(),
      ns: 'https://api.dotdo.dev/test',
      schemaVersion: 1,
    }

    it('validates a correct event', () => {
      const result = validatePlatformEvent(validEvent)
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.event).toBeDefined()
    })

    it('rejects event with missing id', () => {
      const invalid = { ...validEvent, id: '' }
      const result = validatePlatformEvent(invalid)
      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.field === 'id')).toBe(true)
    })

    it('rejects event with invalid category', () => {
      const invalid = { ...validEvent, category: 'invalid' }
      const result = validatePlatformEvent(invalid)
      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.field === 'category')).toBe(true)
    })

    it('rejects event with missing actor', () => {
      const invalid = { ...validEvent, actor: '' }
      const result = validatePlatformEvent(invalid)
      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.field === 'actor')).toBe(true)
    })

    it('rejects event with invalid ns URL', () => {
      const invalid = { ...validEvent, ns: 'not-a-url' }
      const result = validatePlatformEvent(invalid)
      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.field === 'ns')).toBe(true)
    })

    it('validates optional fields when present', () => {
      const eventWithOptionals: PlatformEvent = {
        ...validEvent,
        sessionId: 'sess-123',
        experimentId: 'exp-456',
        variant: 'control',
        value: 100,
        unit: 'tokens',
        apiKeyId: 'key-789',
        statusCode: 200,
        duration: 50.5,
        correlationId: 'corr-abc',
      }

      const result = validatePlatformEvent(eventWithOptionals)
      expect(result.success).toBe(true)
    })
  })
})

// =============================================================================
// CONVENIENCE FUNCTION TESTS
// =============================================================================

describe('Event Input Helpers', () => {
  describe('trackEvent', () => {
    it('creates a track event input', () => {
      const input = trackEvent('Signup', 'user-123', { plan: 'pro' })

      expect(input.category).toBe('track')
      expect(input.type).toBe('Signup')
      expect(input.actor).toBe('user-123')
      expect(input.data).toEqual({ plan: 'pro' })
    })

    it('supports optional fields', () => {
      const input = trackEvent('Signup', 'user-123', { plan: 'pro' }, {
        sessionId: 'sess-abc',
        experimentId: 'exp-123',
        variant: 'treatment',
      })

      expect(input.sessionId).toBe('sess-abc')
      expect(input.experimentId).toBe('exp-123')
      expect(input.variant).toBe('treatment')
    })
  })

  describe('meterEvent', () => {
    it('creates a meter event input', () => {
      const input = meterEvent('api.tokens', 'cust-123', 1000)

      expect(input.category).toBe('meter')
      expect(input.type).toBe('api.tokens')
      expect(input.customerId).toBe('cust-123')
      expect(input.value).toBe(1000)
    })

    it('supports optional fields', () => {
      const input = meterEvent('api.tokens', 'cust-123', 1000, {
        unit: 'tokens',
        dimensions: { model: 'gpt-4' },
        featureId: 'ai-completion',
        idempotencyKey: 'idem-123',
      })

      expect(input.unit).toBe('tokens')
      expect(input.dimensions).toEqual({ model: 'gpt-4' })
      expect(input.featureId).toBe('ai-completion')
      expect(input.idempotencyKey).toBe('idem-123')
    })
  })

  describe('governEvent', () => {
    it('creates a govern event input', () => {
      const input = governEvent('api.request', 'user-123')

      expect(input.category).toBe('govern')
      expect(input.type).toBe('api.request')
      expect(input.actor).toBe('user-123')
    })

    it('supports optional fields', () => {
      const input = governEvent('api.request', 'user-123', {
        apiKeyId: 'key-abc',
        requestPath: '/v1/chat',
        httpMethod: 'POST',
        statusCode: 200,
        duration: 150,
        rateLimitBucket: 'api-standard',
      })

      expect(input.apiKeyId).toBe('key-abc')
      expect(input.requestPath).toBe('/v1/chat')
      expect(input.httpMethod).toBe('POST')
      expect(input.statusCode).toBe(200)
      expect(input.duration).toBe(150)
      expect(input.rateLimitBucket).toBe('api-standard')
    })
  })

  describe('auditEvent', () => {
    it('creates an audit event input', () => {
      const input = auditEvent('entity.deleted', 'admin-123', 'cust-456', 'Customer')

      expect(input.category).toBe('audit')
      expect(input.type).toBe('entity.deleted')
      expect(input.actor).toBe('admin-123')
      expect(input.object).toBe('cust-456')
      expect(input.objectType).toBe('Customer')
    })

    it('supports optional fields', () => {
      const input = auditEvent('entity.deleted', 'admin-123', 'cust-456', 'Customer', {
        reason: 'GDPR deletion request',
        data: { deletedFields: ['email', 'name'] },
      })

      expect(input.reason).toBe('GDPR deletion request')
      expect(input.data).toEqual({ deletedFields: ['email', 'name'] })
    })
  })
})

// =============================================================================
// CATEGORY-SPECIFIC TESTS
// =============================================================================

describe('Event Categories', () => {
  const context = {
    ns: 'https://api.dotdo.dev/test',
  }

  describe('Track Events (Observability)', () => {
    it('supports session tracking', () => {
      const event = createPlatformEvent(
        {
          category: 'track',
          type: 'PageView',
          actor: 'user-123',
          sessionId: 'sess-abc',
          deviceId: 'device-xyz',
          userAgent: 'Mozilla/5.0',
        },
        context
      )

      expect(event.sessionId).toBe('sess-abc')
      expect(event.deviceId).toBe('device-xyz')
      expect(event.userAgent).toBe('Mozilla/5.0')
    })

    it('supports experiment tracking', () => {
      const event = createPlatformEvent(
        {
          category: 'track',
          type: 'ButtonClick',
          actor: 'user-123',
          experimentId: 'exp-onboarding-v2',
          variant: 'treatment-b',
        },
        context
      )

      expect(event.experimentId).toBe('exp-onboarding-v2')
      expect(event.variant).toBe('treatment-b')
    })
  })

  describe('Meter Events (Monetization)', () => {
    it('supports usage metering with dimensions', () => {
      const event = createPlatformEvent(
        {
          category: 'meter',
          type: 'usage.tokens',
          customerId: 'cust-123',
          value: 5000,
          unit: 'tokens',
          dimensions: {
            model: 'claude-3',
            tier: 'enterprise',
          },
        },
        context
      )

      expect(event.customerId).toBe('cust-123')
      expect(event.value).toBe(5000)
      expect(event.unit).toBe('tokens')
      expect(event.dimensions).toEqual({
        model: 'claude-3',
        tier: 'enterprise',
      })
    })

    it('supports subscription tracking', () => {
      const event = createPlatformEvent(
        {
          category: 'meter',
          type: 'usage.requests',
          customerId: 'cust-123',
          value: 1,
          subscriptionId: 'sub-abc',
          planId: 'plan-pro',
          featureId: 'api-access',
        },
        context
      )

      expect(event.subscriptionId).toBe('sub-abc')
      expect(event.planId).toBe('plan-pro')
      expect(event.featureId).toBe('api-access')
    })

    it('auto-generates idempotency key', () => {
      const event = createPlatformEvent(
        {
          category: 'meter',
          type: 'usage.tokens',
          customerId: 'cust-123',
          value: 100,
        },
        context
      )

      expect(event.idempotencyKey).toBeDefined()
      expect(event.idempotencyKey!.startsWith('evt_')).toBe(true)
    })

    it('respects provided idempotency key', () => {
      const event = createPlatformEvent(
        {
          category: 'meter',
          type: 'usage.tokens',
          customerId: 'cust-123',
          value: 100,
          idempotencyKey: 'custom-key-123',
        },
        context
      )

      expect(event.idempotencyKey).toBe('custom-key-123')
    })
  })

  describe('Govern Events (Governance)', () => {
    it('supports API key tracking', () => {
      const event = createPlatformEvent(
        {
          category: 'govern',
          type: 'api.request',
          actor: 'user-123',
          apiKeyId: 'key-abc',
          requestPath: '/v1/completions',
          httpMethod: 'POST',
          statusCode: 200,
          duration: 250,
        },
        context
      )

      expect(event.apiKeyId).toBe('key-abc')
      expect(event.requestPath).toBe('/v1/completions')
      expect(event.httpMethod).toBe('POST')
      expect(event.statusCode).toBe(200)
      expect(event.duration).toBe(250)
    })

    it('supports rate limit tracking', () => {
      const event = createPlatformEvent(
        {
          category: 'govern',
          type: 'ratelimit.exceeded',
          actor: 'user-123',
          rateLimitBucket: 'api-tier-free',
        },
        context
      )

      expect(event.rateLimitBucket).toBe('api-tier-free')
    })

    it('sets actorType to api_key when apiKeyId is present', () => {
      const event = createPlatformEvent(
        {
          category: 'govern',
          type: 'api.request',
          actor: 'user-123',
          apiKeyId: 'key-abc',
        },
        context
      )

      expect(event.actorType).toBe('api_key')
    })
  })

  describe('Audit Events', () => {
    it('tracks entity changes', () => {
      const event = createPlatformEvent(
        {
          category: 'audit',
          type: 'entity.updated',
          actor: 'admin-123',
          object: 'customer-456',
          objectType: 'Customer',
          reason: 'Admin correction',
          data: {
            changes: [
              { field: 'email', from: 'old@example.com', to: 'new@example.com' },
            ],
          },
        },
        context
      )

      expect(event.object).toBe('customer-456')
      expect(event.objectType).toBe('Customer')
      expect(event.reason).toBe('Admin correction')
      expect(event.data.changes).toHaveLength(1)
    })
  })
})

// =============================================================================
// LINKING TESTS
// =============================================================================

describe('Event Linking', () => {
  const context = {
    ns: 'https://api.dotdo.dev/test',
  }

  it('supports correlation IDs for distributed tracing', () => {
    const correlationId = 'corr-' + Date.now()

    const event1 = createPlatformEvent(
      {
        category: 'track',
        type: 'Request.Start',
        actor: 'user-123',
        context: { correlationId },
      },
      context
    )

    const event2 = createPlatformEvent(
      {
        category: 'track',
        type: 'Request.End',
        actor: 'user-123',
        context: { correlationId, parentEventId: event1.id },
      },
      context
    )

    // Events should be linkable via context
    expect(event1.context?.correlationId).toBe(correlationId)
    expect(event2.context?.correlationId).toBe(correlationId)
  })

  it('supports OpenTelemetry trace and span IDs', () => {
    const event = createPlatformEvent(
      {
        category: 'system',
        type: 'span.end',
        context: {
          traceId: 'trace-abc-123',
          spanId: 'span-xyz-456',
        },
      },
      context
    )

    expect(event.context?.traceId).toBe('trace-abc-123')
    expect(event.context?.spanId).toBe('span-xyz-456')
  })
})

// =============================================================================
// EXTENSION TESTS
// =============================================================================

describe('Event Extensions', () => {
  const context = {
    ns: 'https://api.dotdo.dev/test',
  }

  it('supports custom extensions', () => {
    const event = createPlatformEvent(
      {
        category: 'track',
        type: 'Custom',
        actor: 'user-123',
        data: {},
        context: {
          customField1: 'value1',
          customField2: 123,
          nested: { a: 'b' },
        },
      },
      context
    )

    expect(event.context?.customField1).toBe('value1')
    expect(event.context?.customField2).toBe(123)
    expect(event.context?.nested).toEqual({ a: 'b' })
  })
})
