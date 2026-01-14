/**
 * Segment Identify Transformer Tests
 *
 * Tests for transforming Segment-style identify events to the unified event schema.
 * Identify events link anonymous_id to actor_id for identity resolution.
 *
 * @see https://segment.com/docs/connections/spec/identify/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transformSegmentIdentify } from '../segment-identify'
import type { UnifiedEvent } from '../../../../types/unified-event'

// Mock crypto.randomUUID for deterministic tests
const mockUUID = '550e8400-e29b-41d4-a716-446655440000'

describe('transformSegmentIdentify', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('actor mapping', () => {
    it('maps userId to actor_id', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.actor_id).toBe('user_123')
    })

    it('maps anonymousId to anonymous_id', () => {
      const identify = {
        anonymousId: 'anon_456',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.anonymous_id).toBe('anon_456')
    })

    it('sets actor_id to null when userId is absent', () => {
      const identify = {
        anonymousId: 'anon_456',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.actor_id).toBeNull()
    })

    it('sets anonymous_id to null when anonymousId is absent', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.anonymous_id).toBeNull()
    })
  })

  describe('traits mapping', () => {
    it('maps traits to traits JSON', () => {
      const identify = {
        userId: 'user_123',
        traits: {
          name: 'Alice Smith',
          email: 'alice@example.com',
          plan: 'pro',
          company: 'Acme Inc',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.traits).toEqual({
        name: 'Alice Smith',
        email: 'alice@example.com',
        plan: 'pro',
        company: 'Acme Inc',
      })
    })

    it('maps traits.name to actor_name', () => {
      const identify = {
        userId: 'user_123',
        traits: {
          name: 'Bob Jones',
          email: 'bob@example.com',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.actor_name).toBe('Bob Jones')
    })

    it('sets actor_name to null when traits.name is absent', () => {
      const identify = {
        userId: 'user_123',
        traits: {
          email: 'bob@example.com',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.actor_name).toBeNull()
    })

    it('stores traits.email in traits object (queryable)', () => {
      const identify = {
        userId: 'user_123',
        traits: {
          email: 'alice@example.com',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.traits?.email).toBe('alice@example.com')
    })

    it('sets traits to null when no traits provided', () => {
      const identify = {
        userId: 'user_123',
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.traits).toBeNull()
    })
  })

  describe('event classification', () => {
    it('sets event_type to track', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.event_type).toBe('track')
    })

    it('sets event_name to identify', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.event_name).toBe('identify')
    })
  })

  describe('context mapping', () => {
    it('maps context.ip to geo fields via extractSegmentContext', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          ip: '203.0.113.42',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      // IP is stored in context, geo lookup happens separately
      expect(result.context?.ip).toBe('203.0.113.42')
    })

    it('maps context.userAgent to http_user_agent', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.http_user_agent).toBe(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      )
    })

    it('maps context.locale to client device context', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          locale: 'en-US',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.context?.locale).toBe('en-US')
    })

    it('maps context.page to page fields', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          page: {
            url: 'https://example.com/settings',
            path: '/settings',
            title: 'Settings',
            referrer: 'https://google.com',
          },
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.http_url).toBe('https://example.com/settings')
      expect(result.http_path).toBe('/settings')
      expect(result.page_title).toBe('Settings')
      expect(result.http_referrer).toBe('https://google.com')
    })

    it('maps context.campaign (UTM) to campaign fields', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          campaign: {
            name: 'summer-sale',
            source: 'google',
            medium: 'cpc',
            term: 'running shoes',
            content: 'banner-ad',
          },
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.campaign_name).toBe('summer-sale')
      expect(result.campaign_source).toBe('google')
      expect(result.campaign_medium).toBe('cpc')
      expect(result.campaign_term).toBe('running shoes')
      expect(result.campaign_content).toBe('banner-ad')
    })

    it('maps context.device to client device fields', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          device: {
            type: 'mobile',
            model: 'iPhone 14',
            manufacturer: 'Apple',
          },
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.device_type).toBe('mobile')
      expect(result.device_model).toBe('iPhone 14')
      expect(result.device_brand).toBe('Apple')
    })

    it('maps context.os to OS fields', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          os: {
            name: 'iOS',
            version: '17.0',
          },
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.os_name).toBe('iOS')
      expect(result.os_version).toBe('17.0')
    })

    it('maps context.screen to screen_size', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          screen: {
            width: 1920,
            height: 1080,
          },
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.screen_size).toBe('1920x1080')
    })

    it('maps context.library to client info', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        context: {
          library: {
            name: 'analytics.js',
            version: '2.0.0',
          },
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.client_name).toBe('analytics.js')
      expect(result.client_version).toBe('2.0.0')
    })
  })

  describe('identity resolution', () => {
    it('links anonymous_id to actor_id for identity resolution', () => {
      // When both userId and anonymousId are present, this creates
      // an identity link that can be used for user stitching
      const identify = {
        userId: 'user_123',
        anonymousId: 'anon_456',
        traits: {
          name: 'Alice Smith',
        },
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      // Both IDs should be present for identity resolution
      expect(result.actor_id).toBe('user_123')
      expect(result.anonymous_id).toBe('anon_456')
      // This event represents the moment of identity linkage
      expect(result.event_name).toBe('identify')
    })
  })

  describe('timestamp handling', () => {
    it('uses provided timestamp as string', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
        timestamp: '2024-01-15T10:30:00.000Z',
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')
    })

    it('uses provided timestamp as Date', () => {
      const date = new Date('2024-01-15T10:30:00.000Z')
      const identify = {
        userId: 'user_123',
        traits: {},
        timestamp: date,
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')
    })

    it('generates current timestamp when not provided', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))

      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.timestamp).toBe('2024-01-15T12:00:00.000Z')

      vi.useRealTimers()
    })
  })

  describe('core identity fields', () => {
    it('generates unique event id', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.id).toBe(mockUUID)
    })

    it('sets ns from parameter', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://api.acme.com')

      expect(result.ns).toBe('https://api.acme.com')
    })
  })

  describe('event source tracking', () => {
    it('sets event_source to segment', () => {
      const identify = {
        userId: 'user_123',
        traits: {},
      }

      const result = transformSegmentIdentify(identify, 'https://example.com')

      expect(result.event_source).toBe('segment')
    })
  })
})
