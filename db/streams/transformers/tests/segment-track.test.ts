import { describe, it, expect, beforeAll } from 'vitest'

/**
 * Segment Track Transformer Tests
 *
 * These tests verify the transformation of Segment-style track events
 * into the UnifiedEvent schema.
 *
 * This is RED phase TDD - tests should FAIL until the transformer
 * is implemented in db/streams/transformers/segment-track.ts.
 *
 * Segment track events have:
 * - event: The event name (e.g., 'Product Viewed')
 * - userId: Authenticated user identifier
 * - anonymousId: Device/anonymous identifier
 * - properties: Event-specific data
 * - context: Enrichment data (page, device, os, campaign, userAgent)
 * - timestamp: When the event occurred
 *
 * The transformer maps these to UnifiedEvent fields.
 */

import type { UnifiedEvent } from '../../../../types/unified-event'

// ============================================================================
// Segment Track Event Types (Input)
// ============================================================================

interface SegmentTrackEvent {
  event: string
  userId?: string
  anonymousId?: string
  properties?: Record<string, unknown>
  context?: {
    page?: { url?: string; path?: string; referrer?: string; title?: string; search?: string }
    campaign?: { name?: string; source?: string; medium?: string; term?: string; content?: string }
    device?: { type?: string; model?: string; brand?: string; id?: string }
    os?: { name?: string; version?: string }
    userAgent?: string
    ip?: string
    locale?: string
    timezone?: string
  }
  timestamp?: string | Date
}

// ============================================================================
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformSegmentTrack: ((track: SegmentTrackEvent, ns: string) => UnifiedEvent) | undefined

beforeAll(async () => {
  try {
    const module = await import('../segment-track')
    transformSegmentTrack = module.transformSegmentTrack
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
  }
})

// ============================================================================
// Core Field Mapping Tests
// ============================================================================

describe('Core Field Mapping', () => {
  describe('event -> event_name', () => {
    it('maps event to event_name', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Product Viewed',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.event_name).toBe('Product Viewed')
    })
  })

  describe('userId -> actor_id', () => {
    it('maps userId to actor_id', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Purchase Completed',
        userId: 'user-123',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.actor_id).toBe('user-123')
    })

    it('sets actor_id to null when userId not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Page Viewed',
        anonymousId: 'anon-456',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.actor_id).toBeNull()
    })
  })

  describe('anonymousId -> anonymous_id', () => {
    it('maps anonymousId to anonymous_id', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Page Viewed',
        anonymousId: 'anon-device-xyz',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.anonymous_id).toBe('anon-device-xyz')
    })

    it('sets anonymous_id to null when anonymousId not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Purchase Completed',
        userId: 'user-123',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.anonymous_id).toBeNull()
    })
  })

  describe('properties -> properties JSON', () => {
    it('maps properties to properties field', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Product Added',
        properties: {
          product_id: 'prod-123',
          price: 99.99,
          quantity: 2,
          category: 'Electronics',
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.properties).toEqual({
        product_id: 'prod-123',
        price: 99.99,
        quantity: 2,
        category: 'Electronics',
      })
    })

    it('sets properties to null when not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Simple Event',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.properties).toBeNull()
    })
  })
})

// ============================================================================
// Page Context Mapping Tests
// ============================================================================

describe('Page Context Mapping', () => {
  describe('context.page.url -> http_url', () => {
    it('maps context.page.url to http_url', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Button Clicked',
        context: {
          page: {
            url: 'https://example.com/products/123',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.http_url).toBe('https://example.com/products/123')
    })
  })

  describe('context.page.path -> http_path', () => {
    it('maps context.page.path to http_path', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Form Submitted',
        context: {
          page: {
            path: '/checkout/payment',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.http_path).toBe('/checkout/payment')
    })
  })

  describe('context.page.referrer -> http_referrer', () => {
    it('maps context.page.referrer to http_referrer', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Signup Completed',
        context: {
          page: {
            referrer: 'https://google.com/search?q=best+products',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.http_referrer).toBe('https://google.com/search?q=best+products')
    })
  })

  describe('page fields null when not provided', () => {
    it('sets page fields to null when context.page not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Mobile Event',
        context: {},
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.http_url).toBeNull()
      expect(result.http_path).toBeNull()
      expect(result.http_referrer).toBeNull()
    })
  })
})

// ============================================================================
// Campaign Context Mapping Tests
// ============================================================================

describe('Campaign Context Mapping', () => {
  describe('context.campaign.name -> campaign_name', () => {
    it('maps context.campaign.name to campaign_name', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Signup Completed',
        context: {
          campaign: {
            name: 'Summer Sale 2024',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.campaign_name).toBe('Summer Sale 2024')
    })
  })

  describe('context.campaign.source -> campaign_source', () => {
    it('maps context.campaign.source to campaign_source', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Signup Completed',
        context: {
          campaign: {
            source: 'google',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.campaign_source).toBe('google')
    })
  })

  describe('context.campaign.medium -> campaign_medium', () => {
    it('maps context.campaign.medium to campaign_medium', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Signup Completed',
        context: {
          campaign: {
            medium: 'cpc',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.campaign_medium).toBe('cpc')
    })
  })

  describe('context.campaign.term -> campaign_term', () => {
    it('maps context.campaign.term to campaign_term', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Signup Completed',
        context: {
          campaign: {
            term: 'running shoes',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.campaign_term).toBe('running shoes')
    })
  })

  describe('context.campaign.content -> campaign_content', () => {
    it('maps context.campaign.content to campaign_content', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Signup Completed',
        context: {
          campaign: {
            content: 'banner-ad-v2',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.campaign_content).toBe('banner-ad-v2')
    })
  })

  describe('full campaign context mapping', () => {
    it('maps all campaign fields together', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Purchase Completed',
        context: {
          campaign: {
            name: 'Black Friday',
            source: 'facebook',
            medium: 'paid_social',
            term: 'electronics deals',
            content: 'carousel-ad-1',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.campaign_name).toBe('Black Friday')
      expect(result.campaign_source).toBe('facebook')
      expect(result.campaign_medium).toBe('paid_social')
      expect(result.campaign_term).toBe('electronics deals')
      expect(result.campaign_content).toBe('carousel-ad-1')
    })
  })
})

// ============================================================================
// Device Context Mapping Tests
// ============================================================================

describe('Device Context Mapping', () => {
  describe('context.device.type -> device_type', () => {
    it('maps context.device.type to device_type', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'App Opened',
        context: {
          device: {
            type: 'mobile',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.device_type).toBe('mobile')
    })
  })

  describe('context.device.model -> device_model', () => {
    it('maps context.device.model to device_model', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'App Opened',
        context: {
          device: {
            model: 'iPhone 15 Pro',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.device_model).toBe('iPhone 15 Pro')
    })
  })

  describe('context.device.brand -> device_brand', () => {
    it('maps context.device.brand to device_brand', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'App Opened',
        context: {
          device: {
            brand: 'Apple',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.device_brand).toBe('Apple')
    })
  })

  describe('device fields null when not provided', () => {
    it('sets device fields to null when context.device not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Web Event',
        context: {},
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.device_type).toBeNull()
      expect(result.device_model).toBeNull()
      expect(result.device_brand).toBeNull()
    })
  })
})

// ============================================================================
// OS Context Mapping Tests
// ============================================================================

describe('OS Context Mapping', () => {
  describe('context.os.name -> os_name', () => {
    it('maps context.os.name to os_name', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'App Opened',
        context: {
          os: {
            name: 'iOS',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.os_name).toBe('iOS')
    })
  })

  describe('context.os.version -> os_version', () => {
    it('maps context.os.version to os_version', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'App Opened',
        context: {
          os: {
            version: '17.2.1',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.os_version).toBe('17.2.1')
    })
  })

  describe('os fields null when not provided', () => {
    it('sets os fields to null when context.os not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Web Event',
        context: {},
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.os_name).toBeNull()
      expect(result.os_version).toBeNull()
    })
  })
})

// ============================================================================
// User Agent Mapping Tests
// ============================================================================

describe('User Agent Mapping', () => {
  describe('context.userAgent -> http_user_agent', () => {
    it('maps context.userAgent to http_user_agent', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Page Viewed',
        context: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.http_user_agent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    })

    it('sets http_user_agent to null when context.userAgent not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Mobile Event',
        context: {},
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.http_user_agent).toBeNull()
    })
  })
})

// ============================================================================
// Timestamp Mapping Tests
// ============================================================================

describe('Timestamp Mapping', () => {
  describe('timestamp -> timestamp', () => {
    it('maps ISO string timestamp to timestamp field', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Order Placed',
        timestamp: '2024-01-15T14:30:45.123Z',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.timestamp).toBe('2024-01-15T14:30:45.123Z')
    })

    it('maps Date object timestamp to ISO string', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const date = new Date('2024-06-20T09:15:30.000Z')
      const track: SegmentTrackEvent = {
        event: 'Order Placed',
        timestamp: date,
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.timestamp).toBe('2024-06-20T09:15:30.000Z')
    })

    it('sets timestamp to null when not provided', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Quick Event',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      // When not provided, should generate current timestamp or be null
      // Based on typical behavior, it should be null if not provided
      expect(result.timestamp).toBeNull()
    })
  })
})

// ============================================================================
// Event Type Tests
// ============================================================================

describe('Event Type', () => {
  describe('event_type is set to "track"', () => {
    it('sets event_type to "track"', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Any Event',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.event_type).toBe('track')
    })
  })
})

// ============================================================================
// Namespace Tests
// ============================================================================

describe('Namespace', () => {
  describe('ns parameter is mapped to ns field', () => {
    it('sets ns from parameter', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Test Event',
      }

      const result = transformSegmentTrack!(track, 'https://my-app.example.com')
      expect(result.ns).toBe('https://my-app.example.com')
    })
  })
})

// ============================================================================
// ID Generation Tests
// ============================================================================

describe('ID Generation', () => {
  describe('id is generated', () => {
    it('generates a unique id', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Test Event',
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
    })

    it('generates different ids for different calls', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Test Event',
      }

      const result1 = transformSegmentTrack!(track, 'https://test.ns')
      const result2 = transformSegmentTrack!(track, 'https://test.ns')
      expect(result1.id).not.toBe(result2.id)
    })
  })
})

// ============================================================================
// Complete Event Transformation Tests
// ============================================================================

describe('Complete Event Transformation', () => {
  it('transforms a full Segment track event', () => {
    expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

    const track: SegmentTrackEvent = {
      event: 'Order Completed',
      userId: 'user-abc123',
      anonymousId: 'device-xyz789',
      properties: {
        order_id: 'order-456',
        total: 299.99,
        currency: 'USD',
        products: [
          { sku: 'SKU-001', name: 'Widget', price: 99.99 },
          { sku: 'SKU-002', name: 'Gadget', price: 200.00 },
        ],
      },
      context: {
        page: {
          url: 'https://shop.example.com/checkout/confirm',
          path: '/checkout/confirm',
          referrer: 'https://shop.example.com/cart',
          title: 'Order Confirmation',
          search: '?promo=SAVE10',
        },
        campaign: {
          name: 'Holiday Sale',
          source: 'email',
          medium: 'newsletter',
          term: 'gifts',
          content: 'header-banner',
        },
        device: {
          type: 'desktop',
          model: 'MacBook Pro',
          brand: 'Apple',
        },
        os: {
          name: 'macOS',
          version: '14.2',
        },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      timestamp: '2024-01-15T14:30:00.000Z',
    }

    const result = transformSegmentTrack!(track, 'https://shop.example.com')

    // Core fields
    expect(result.event_type).toBe('track')
    expect(result.event_name).toBe('Order Completed')
    expect(result.ns).toBe('https://shop.example.com')

    // Actor fields
    expect(result.actor_id).toBe('user-abc123')
    expect(result.anonymous_id).toBe('device-xyz789')

    // Properties
    expect(result.properties).toEqual({
      order_id: 'order-456',
      total: 299.99,
      currency: 'USD',
      products: [
        { sku: 'SKU-001', name: 'Widget', price: 99.99 },
        { sku: 'SKU-002', name: 'Gadget', price: 200.00 },
      ],
    })

    // Page context
    expect(result.http_url).toBe('https://shop.example.com/checkout/confirm')
    expect(result.http_path).toBe('/checkout/confirm')
    expect(result.http_referrer).toBe('https://shop.example.com/cart')

    // Campaign context
    expect(result.campaign_name).toBe('Holiday Sale')
    expect(result.campaign_source).toBe('email')
    expect(result.campaign_medium).toBe('newsletter')
    expect(result.campaign_term).toBe('gifts')
    expect(result.campaign_content).toBe('header-banner')

    // Device context
    expect(result.device_type).toBe('desktop')
    expect(result.device_model).toBe('MacBook Pro')
    expect(result.device_brand).toBe('Apple')

    // OS context
    expect(result.os_name).toBe('macOS')
    expect(result.os_version).toBe('14.2')

    // User agent
    expect(result.http_user_agent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')

    // Timestamp
    expect(result.timestamp).toBe('2024-01-15T14:30:00.000Z')
  })

  it('transforms minimal Segment track event', () => {
    expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

    const track: SegmentTrackEvent = {
      event: 'Button Clicked',
    }

    const result = transformSegmentTrack!(track, 'https://test.ns')

    // Required fields
    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('track')
    expect(result.event_name).toBe('Button Clicked')
    expect(result.ns).toBe('https://test.ns')

    // Optional fields should be null
    expect(result.actor_id).toBeNull()
    expect(result.anonymous_id).toBeNull()
    expect(result.properties).toBeNull()
    expect(result.http_url).toBeNull()
    expect(result.http_path).toBeNull()
    expect(result.http_referrer).toBeNull()
    expect(result.campaign_name).toBeNull()
    expect(result.device_type).toBeNull()
    expect(result.os_name).toBeNull()
    expect(result.http_user_agent).toBeNull()
  })
})

// ============================================================================
// Event Source Tests
// ============================================================================

describe('Event Source', () => {
  it('sets event_source to "segment"', () => {
    expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

    const track: SegmentTrackEvent = {
      event: 'Test Event',
    }

    const result = transformSegmentTrack!(track, 'https://test.ns')
    expect(result.event_source).toBe('segment')
  })
})

// ============================================================================
// Page Title and Search Tests
// ============================================================================

describe('Page Title and Search', () => {
  describe('context.page.title -> page_title', () => {
    it('maps context.page.title to page_title', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Page Viewed',
        context: {
          page: {
            title: 'Product Details - Widget Pro',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.page_title).toBe('Product Details - Widget Pro')
    })
  })

  describe('context.page.search -> page_search', () => {
    it('maps context.page.search to page_search', () => {
      expect(transformSegmentTrack, 'transformSegmentTrack should be exported').toBeDefined()

      const track: SegmentTrackEvent = {
        event: 'Search Performed',
        context: {
          page: {
            search: '?q=widget&category=electronics',
          },
        },
      }

      const result = transformSegmentTrack!(track, 'https://test.ns')
      expect(result.page_search).toBe('?q=widget&category=electronics')
    })
  })
})
