/**
 * Segment Page Event Transformer Tests
 *
 * Tests for transforming Segment-style page events to unified schema.
 *
 * Note: The unified event schema uses:
 * - page_title, page_search for page-specific fields
 * - http_url, http_path, http_referrer, http_query for URL fields
 * (There are no page_url, page_path, page_referrer fields in the schema)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transformSegmentPage } from '../segment-page'

describe('transformSegmentPage', () => {
  // Mock crypto.randomUUID for deterministic IDs
  const mockUUID = '550e8400-e29b-41d4-a716-446655440000'

  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: () => mockUUID,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('basic page event mapping', () => {
    it('sets event_type to "page"', () => {
      const result = transformSegmentPage({}, 'test-ns')

      expect(result.event_type).toBe('page')
    })

    it('sets event_name to "page_view" when no category', () => {
      const result = transformSegmentPage({}, 'test-ns')

      expect(result.event_name).toBe('page_view')
    })

    it('sets event_name to "{category}.page_view" when category provided', () => {
      const result = transformSegmentPage(
        { category: 'Docs' },
        'test-ns'
      )

      expect(result.event_name).toBe('Docs.page_view')
    })

    it('generates a UUID for event id', () => {
      const result = transformSegmentPage({}, 'test-ns')

      expect(result.id).toBe(mockUUID)
    })

    it('sets namespace from ns parameter', () => {
      const result = transformSegmentPage({}, 'my-namespace')

      expect(result.ns).toBe('my-namespace')
    })
  })

  describe('page name and title mapping', () => {
    it('maps name to page_title', () => {
      const result = transformSegmentPage(
        { name: 'Getting Started' },
        'test-ns'
      )

      expect(result.page_title).toBe('Getting Started')
    })

    it('maps properties.title to page_title as fallback', () => {
      const result = transformSegmentPage(
        {
          properties: {
            title: 'Page Title from Properties',
          },
        },
        'test-ns'
      )

      expect(result.page_title).toBe('Page Title from Properties')
    })

    it('prefers name over properties.title', () => {
      const result = transformSegmentPage(
        {
          name: 'Name Takes Priority',
          properties: {
            title: 'Properties Title',
          },
        },
        'test-ns'
      )

      expect(result.page_title).toBe('Name Takes Priority')
    })
  })

  describe('URL and path mapping', () => {
    it('maps properties.url to http_url', () => {
      const result = transformSegmentPage(
        {
          properties: {
            url: 'https://docs.example.com/getting-started',
          },
        },
        'test-ns'
      )

      expect(result.http_url).toBe('https://docs.example.com/getting-started')
    })

    it('maps properties.path to http_path', () => {
      const result = transformSegmentPage(
        {
          properties: {
            path: '/docs/getting-started',
          },
        },
        'test-ns'
      )

      expect(result.http_path).toBe('/docs/getting-started')
    })

    it('maps properties.referrer to http_referrer', () => {
      const result = transformSegmentPage(
        {
          properties: {
            referrer: 'https://google.com/search?q=docs',
          },
        },
        'test-ns'
      )

      expect(result.http_referrer).toBe('https://google.com/search?q=docs')
    })

    it('maps properties.search to page_search and http_query', () => {
      const result = transformSegmentPage(
        {
          properties: {
            search: '?q=getting+started&page=1',
          },
        },
        'test-ns'
      )

      expect(result.page_search).toBe('?q=getting+started&page=1')
      expect(result.http_query).toBe('?q=getting+started&page=1')
    })
  })

  describe('user identity mapping', () => {
    it('maps userId to actor_id', () => {
      const result = transformSegmentPage(
        { userId: 'user-123' },
        'test-ns'
      )

      expect(result.actor_id).toBe('user-123')
    })

    it('maps anonymousId to anonymous_id', () => {
      const result = transformSegmentPage(
        { anonymousId: 'anon-456' },
        'test-ns'
      )

      expect(result.anonymous_id).toBe('anon-456')
    })

    it('handles both userId and anonymousId', () => {
      const result = transformSegmentPage(
        {
          userId: 'user-123',
          anonymousId: 'anon-456',
        },
        'test-ns'
      )

      expect(result.actor_id).toBe('user-123')
      expect(result.anonymous_id).toBe('anon-456')
    })
  })

  describe('context mapping', () => {
    it('extracts context.page fields', () => {
      const result = transformSegmentPage(
        {
          context: {
            page: {
              url: 'https://context.example.com/page',
              path: '/context-path',
              referrer: 'https://context-referrer.com',
              title: 'Context Title',
              search: '?from=context',
            },
          },
        },
        'test-ns'
      )

      // Context page fields are fallbacks, so they show when properties are empty
      expect(result.http_url).toBe('https://context.example.com/page')
      expect(result.http_path).toBe('/context-path')
      expect(result.http_referrer).toBe('https://context-referrer.com')
    })

    it('extracts context.campaign fields (UTM)', () => {
      const result = transformSegmentPage(
        {
          context: {
            campaign: {
              name: 'spring-sale',
              source: 'google',
              medium: 'cpc',
              term: 'dotdo',
              content: 'banner-1',
            },
          },
        },
        'test-ns'
      )

      expect(result.campaign_name).toBe('spring-sale')
      expect(result.campaign_source).toBe('google')
      expect(result.campaign_medium).toBe('cpc')
      expect(result.campaign_term).toBe('dotdo')
      expect(result.campaign_content).toBe('banner-1')
    })

    it('extracts context.device fields', () => {
      const result = transformSegmentPage(
        {
          context: {
            device: {
              type: 'mobile',
              model: 'iPhone 14',
              manufacturer: 'Apple',
            },
          },
        },
        'test-ns'
      )

      expect(result.device_type).toBe('mobile')
      expect(result.device_model).toBe('iPhone 14')
      expect(result.device_brand).toBe('Apple')
    })

    it('extracts context.os fields', () => {
      const result = transformSegmentPage(
        {
          context: {
            os: {
              name: 'iOS',
              version: '17.0',
            },
          },
        },
        'test-ns'
      )

      expect(result.os_name).toBe('iOS')
      expect(result.os_version).toBe('17.0')
    })

    it('extracts context.location fields', () => {
      const result = transformSegmentPage(
        {
          context: {
            location: {
              country: 'US',
              region: 'CA',
              city: 'San Francisco',
              latitude: 37.7749,
              longitude: -122.4194,
            },
          },
        },
        'test-ns'
      )

      expect(result.geo_country).toBe('US')
      expect(result.geo_region).toBe('CA')
      expect(result.geo_city).toBe('San Francisco')
      expect(result.geo_latitude).toBe(37.7749)
      expect(result.geo_longitude).toBe(-122.4194)
    })

    it('extracts context.userAgent to http_user_agent', () => {
      const result = transformSegmentPage(
        {
          context: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
          },
        },
        'test-ns'
      )

      expect(result.http_user_agent).toBe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')
    })

    it('extracts context.timezone to geo_timezone', () => {
      const result = transformSegmentPage(
        {
          context: {
            timezone: 'America/Los_Angeles',
          },
        },
        'test-ns'
      )

      expect(result.geo_timezone).toBe('America/Los_Angeles')
    })

    it('extracts context.library fields', () => {
      const result = transformSegmentPage(
        {
          context: {
            library: {
              name: 'analytics.js',
              version: '4.1.0',
            },
          },
        },
        'test-ns'
      )

      expect(result.client_name).toBe('analytics.js')
      expect(result.client_version).toBe('4.1.0')
    })
  })

  describe('properties priority over context', () => {
    it('prefers properties.url over context.page.url', () => {
      const result = transformSegmentPage(
        {
          properties: {
            url: 'https://properties-url.com',
          },
          context: {
            page: {
              url: 'https://context-url.com',
            },
          },
        },
        'test-ns'
      )

      expect(result.http_url).toBe('https://properties-url.com')
    })

    it('prefers properties.path over context.page.path', () => {
      const result = transformSegmentPage(
        {
          properties: {
            path: '/properties-path',
          },
          context: {
            page: {
              path: '/context-path',
            },
          },
        },
        'test-ns'
      )

      expect(result.http_path).toBe('/properties-path')
    })

    it('prefers properties.referrer over context.page.referrer', () => {
      const result = transformSegmentPage(
        {
          properties: {
            referrer: 'https://properties-referrer.com',
          },
          context: {
            page: {
              referrer: 'https://context-referrer.com',
            },
          },
        },
        'test-ns'
      )

      expect(result.http_referrer).toBe('https://properties-referrer.com')
    })
  })

  describe('timestamp handling', () => {
    it('uses provided timestamp string', () => {
      const timestamp = '2024-01-15T10:30:00.000Z'
      const result = transformSegmentPage(
        { timestamp },
        'test-ns'
      )

      expect(result.timestamp).toBe(timestamp)
    })

    it('converts Date object to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00.000Z')
      const result = transformSegmentPage(
        { timestamp: date },
        'test-ns'
      )

      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')
    })

    it('generates timestamp when not provided', () => {
      const before = Date.now()
      const result = transformSegmentPage({}, 'test-ns')
      const after = Date.now()

      expect(result.timestamp).toBeDefined()
      const resultTime = new Date(result.timestamp!).getTime()
      expect(resultTime).toBeGreaterThanOrEqual(before)
      expect(resultTime).toBeLessThanOrEqual(after)
    })
  })

  describe('properties preservation', () => {
    it('stores original properties in properties field', () => {
      const properties = {
        url: 'https://example.com',
        path: '/test',
        customField: 'custom-value',
        numericField: 42,
      }

      const result = transformSegmentPage(
        { properties },
        'test-ns'
      )

      expect(result.properties).toEqual(properties)
    })

    it('sets properties to null when not provided', () => {
      const result = transformSegmentPage({}, 'test-ns')

      expect(result.properties).toBeNull()
    })
  })

  describe('complete event transformation', () => {
    it('transforms a full Segment page event', () => {
      const segmentEvent = {
        name: 'Getting Started',
        category: 'Docs',
        userId: 'user-123',
        anonymousId: 'anon-456',
        timestamp: '2024-01-15T10:30:00.000Z',
        properties: {
          url: 'https://docs.example.com/getting-started',
          path: '/getting-started',
          referrer: 'https://google.com',
          title: 'Getting Started Guide',
          search: '?section=intro',
        },
        context: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          timezone: 'America/Los_Angeles',
          page: {
            url: 'https://docs.example.com/getting-started',
            path: '/getting-started',
          },
          campaign: {
            name: 'docs-launch',
            source: 'twitter',
            medium: 'social',
          },
          device: {
            type: 'desktop',
            model: 'MacBook Pro',
            manufacturer: 'Apple',
          },
          os: {
            name: 'macOS',
            version: '14.0',
          },
          location: {
            country: 'US',
            region: 'CA',
            city: 'San Francisco',
          },
          library: {
            name: 'analytics.js',
            version: '4.1.0',
          },
        },
      }

      const result = transformSegmentPage(segmentEvent, 'docs-site')

      // Core identity
      expect(result.id).toBe(mockUUID)
      expect(result.event_type).toBe('page')
      expect(result.event_name).toBe('Docs.page_view')
      expect(result.ns).toBe('docs-site')

      // Actor
      expect(result.actor_id).toBe('user-123')
      expect(result.anonymous_id).toBe('anon-456')

      // Page fields (from schema: page_title, page_search)
      expect(result.page_title).toBe('Getting Started')
      expect(result.page_search).toBe('?section=intro')

      // HTTP fields (from properties, takes priority)
      expect(result.http_url).toBe('https://docs.example.com/getting-started')
      expect(result.http_path).toBe('/getting-started')
      expect(result.http_referrer).toBe('https://google.com')
      expect(result.http_query).toBe('?section=intro')
      expect(result.http_user_agent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')

      // Campaign
      expect(result.campaign_name).toBe('docs-launch')
      expect(result.campaign_source).toBe('twitter')
      expect(result.campaign_medium).toBe('social')

      // Device
      expect(result.device_type).toBe('desktop')
      expect(result.device_model).toBe('MacBook Pro')
      expect(result.device_brand).toBe('Apple')

      // OS
      expect(result.os_name).toBe('macOS')
      expect(result.os_version).toBe('14.0')

      // Geo
      expect(result.geo_country).toBe('US')
      expect(result.geo_region).toBe('CA')
      expect(result.geo_city).toBe('San Francisco')
      expect(result.geo_timezone).toBe('America/Los_Angeles')

      // Client
      expect(result.client_name).toBe('analytics.js')
      expect(result.client_version).toBe('4.1.0')

      // Timestamp
      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')

      // Properties preserved
      expect(result.properties).toEqual(segmentEvent.properties)
    })
  })

  describe('null handling for missing fields', () => {
    it('returns null for all optional fields when minimal event', () => {
      const result = transformSegmentPage({}, 'test-ns')

      // All optional fields should be null
      expect(result.actor_id).toBeNull()
      expect(result.anonymous_id).toBeNull()
      expect(result.page_title).toBeNull()
      expect(result.page_search).toBeNull()
      expect(result.http_url).toBeNull()
      expect(result.http_path).toBeNull()
      expect(result.http_referrer).toBeNull()
      expect(result.http_query).toBeNull()
      expect(result.http_user_agent).toBeNull()
      expect(result.campaign_name).toBeNull()
      expect(result.campaign_source).toBeNull()
      expect(result.campaign_medium).toBeNull()
      expect(result.campaign_term).toBeNull()
      expect(result.campaign_content).toBeNull()
      expect(result.device_type).toBeNull()
      expect(result.device_model).toBeNull()
      expect(result.device_brand).toBeNull()
      expect(result.os_name).toBeNull()
      expect(result.os_version).toBeNull()
      expect(result.geo_country).toBeNull()
      expect(result.geo_region).toBeNull()
      expect(result.geo_city).toBeNull()
      expect(result.geo_latitude).toBeNull()
      expect(result.geo_longitude).toBeNull()
      expect(result.geo_timezone).toBeNull()
      expect(result.client_name).toBeNull()
      expect(result.client_version).toBeNull()
    })
  })
})
