/**
 * Analytics Types Contract Tests
 *
 * TDD RED Phase: These tests define the expected type contracts
 * for Segment-compatible analytics types.
 *
 * Test Coverage:
 * - AnalyticsEventType union (track, identify, page, screen, group, alias)
 * - AnalyticsEvent base interface with required fields
 * - UserTraits with all Segment reserved traits
 * - EventContext with all context fields
 * - PropertyOperations for profile updates
 * - Event-specific interfaces (TrackEvent, IdentifyEvent, etc.)
 *
 * @module @dotdo/compat/analytics/types.test
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  AnalyticsEventType,
  AnalyticsEvent,
  UserTraits,
  EventContext,
  PropertyOperations,
  TrackEvent,
  IdentifyEvent,
  PageEvent,
  ScreenEvent,
  GroupEvent,
  AliasEvent,
} from './types'
import {
  isValidAnalyticsEvent,
  isValidUserTraits,
  isValidEventContext,
} from './types'

// ============================================================================
// ANALYTICS EVENT TYPE TESTS
// ============================================================================

describe('AnalyticsEventType', () => {
  it('should include all Segment event types', () => {
    // All six Segment event types must be valid
    const types: AnalyticsEventType[] = [
      'track',
      'identify',
      'page',
      'screen',
      'group',
      'alias',
    ]
    expect(types).toHaveLength(6)
  })

  it('should have correct type inference for track', () => {
    const t: AnalyticsEventType = 'track'
    expectTypeOf(t).toMatchTypeOf<'track'>()
  })

  it('should have correct type inference for identify', () => {
    const t: AnalyticsEventType = 'identify'
    expectTypeOf(t).toMatchTypeOf<'identify'>()
  })

  it('should have correct type inference for page', () => {
    const t: AnalyticsEventType = 'page'
    expectTypeOf(t).toMatchTypeOf<'page'>()
  })

  it('should have correct type inference for screen', () => {
    const t: AnalyticsEventType = 'screen'
    expectTypeOf(t).toMatchTypeOf<'screen'>()
  })

  it('should have correct type inference for group', () => {
    const t: AnalyticsEventType = 'group'
    expectTypeOf(t).toMatchTypeOf<'group'>()
  })

  it('should have correct type inference for alias', () => {
    const t: AnalyticsEventType = 'alias'
    expectTypeOf(t).toMatchTypeOf<'alias'>()
  })
})

// ============================================================================
// ANALYTICS EVENT BASE TESTS
// ============================================================================

describe('AnalyticsEvent', () => {
  it('should require type field', () => {
    const event: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
    }
    expectTypeOf(event).toHaveProperty('type')
  })

  it('should require at least anonymousId or userId', () => {
    // Valid with anonymousId
    const event1: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
    }
    expect(event1.anonymousId).toBe('anon-123')

    // Valid with userId
    const event2: AnalyticsEvent = {
      type: 'track',
      userId: 'user-456',
    }
    expect(event2.userId).toBe('user-456')

    // Valid with both
    const event3: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
      userId: 'user-456',
    }
    expect(event3.anonymousId).toBe('anon-123')
    expect(event3.userId).toBe('user-456')
  })

  it('should have optional timestamp', () => {
    const event: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
      timestamp: new Date().toISOString(),
    }
    expectTypeOf(event.timestamp).toMatchTypeOf<string | undefined>()
  })

  it('should have optional messageId', () => {
    const event: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
      messageId: 'msg-789',
    }
    expectTypeOf(event.messageId).toMatchTypeOf<string | undefined>()
  })

  it('should have optional context', () => {
    const event: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
      context: {},
    }
    expectTypeOf(event.context).toMatchTypeOf<EventContext | undefined>()
  })

  it('should have optional integrations', () => {
    const event: AnalyticsEvent = {
      type: 'track',
      anonymousId: 'anon-123',
      integrations: {
        All: true,
        Mixpanel: false,
      },
    }
    expectTypeOf(event.integrations).toMatchTypeOf<Record<string, boolean> | undefined>()
  })
})

// ============================================================================
// USER TRAITS TESTS (Segment Reserved Traits)
// ============================================================================

describe('UserTraits', () => {
  describe('reserved traits', () => {
    it('should support email trait', () => {
      const traits: UserTraits = { email: 'test@example.com' }
      expectTypeOf(traits.email).toMatchTypeOf<string | undefined>()
    })

    it('should support name trait', () => {
      const traits: UserTraits = { name: 'John Doe' }
      expectTypeOf(traits.name).toMatchTypeOf<string | undefined>()
    })

    it('should support firstName trait', () => {
      const traits: UserTraits = { firstName: 'John' }
      expectTypeOf(traits.firstName).toMatchTypeOf<string | undefined>()
    })

    it('should support lastName trait', () => {
      const traits: UserTraits = { lastName: 'Doe' }
      expectTypeOf(traits.lastName).toMatchTypeOf<string | undefined>()
    })

    it('should support phone trait', () => {
      const traits: UserTraits = { phone: '+1-555-555-5555' }
      expectTypeOf(traits.phone).toMatchTypeOf<string | undefined>()
    })

    it('should support username trait', () => {
      const traits: UserTraits = { username: 'johndoe' }
      expectTypeOf(traits.username).toMatchTypeOf<string | undefined>()
    })

    it('should support avatar trait', () => {
      const traits: UserTraits = { avatar: 'https://example.com/avatar.jpg' }
      expectTypeOf(traits.avatar).toMatchTypeOf<string | undefined>()
    })

    it('should support title trait', () => {
      const traits: UserTraits = { title: 'Software Engineer' }
      expectTypeOf(traits.title).toMatchTypeOf<string | undefined>()
    })

    it('should support age trait', () => {
      const traits: UserTraits = { age: 30 }
      expectTypeOf(traits.age).toMatchTypeOf<number | undefined>()
    })

    it('should support birthday trait', () => {
      const traits: UserTraits = { birthday: '1990-01-15' }
      expectTypeOf(traits.birthday).toMatchTypeOf<string | Date | undefined>()
    })

    it('should support createdAt trait', () => {
      const traits: UserTraits = { createdAt: new Date().toISOString() }
      expectTypeOf(traits.createdAt).toMatchTypeOf<string | Date | undefined>()
    })

    it('should support description trait', () => {
      const traits: UserTraits = { description: 'A software developer' }
      expectTypeOf(traits.description).toMatchTypeOf<string | undefined>()
    })

    it('should support gender trait', () => {
      const traits: UserTraits = { gender: 'male' }
      expectTypeOf(traits.gender).toMatchTypeOf<string | undefined>()
    })

    it('should support website trait', () => {
      const traits: UserTraits = { website: 'https://example.com' }
      expectTypeOf(traits.website).toMatchTypeOf<string | undefined>()
    })
  })

  describe('nested address trait', () => {
    it('should support address object', () => {
      const traits: UserTraits = {
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94102',
          country: 'USA',
        },
      }
      expectTypeOf(traits.address).toMatchTypeOf<{
        street?: string
        city?: string
        state?: string
        postalCode?: string
        country?: string
      } | undefined>()
    })
  })

  describe('nested company trait', () => {
    it('should support company object', () => {
      const traits: UserTraits = {
        company: {
          id: 'company-123',
          name: 'Acme Inc',
          industry: 'Technology',
          employee_count: 100,
          plan: 'enterprise',
        },
      }
      expectTypeOf(traits.company).toMatchTypeOf<{
        id?: string
        name?: string
        industry?: string
        employee_count?: number
        plan?: string
      } | undefined>()
    })
  })

  describe('custom traits', () => {
    it('should allow custom string traits', () => {
      const traits: UserTraits = {
        customField: 'custom value',
      }
      expect(traits.customField).toBe('custom value')
    })

    it('should allow custom number traits', () => {
      const traits: UserTraits = {
        loginCount: 42,
      }
      expect(traits.loginCount).toBe(42)
    })

    it('should allow custom boolean traits', () => {
      const traits: UserTraits = {
        isVerified: true,
      }
      expect(traits.isVerified).toBe(true)
    })

    it('should allow custom array traits', () => {
      const traits: UserTraits = {
        interests: ['coding', 'music', 'travel'],
      }
      expect(traits.interests).toEqual(['coding', 'music', 'travel'])
    })

    it('should allow custom nested object traits', () => {
      const traits: UserTraits = {
        preferences: {
          theme: 'dark',
          notifications: true,
        },
      }
      expect(traits.preferences).toEqual({
        theme: 'dark',
        notifications: true,
      })
    })
  })
})

// ============================================================================
// EVENT CONTEXT TESTS
// ============================================================================

describe('EventContext', () => {
  describe('app context', () => {
    it('should support app object', () => {
      const context: EventContext = {
        app: {
          name: 'MyApp',
          version: '1.0.0',
          build: '100',
          namespace: 'com.example.myapp',
        },
      }
      expectTypeOf(context.app).toMatchTypeOf<{
        name?: string
        version?: string
        build?: string
        namespace?: string
      } | undefined>()
    })
  })

  describe('campaign context', () => {
    it('should support campaign object (UTM params)', () => {
      const context: EventContext = {
        campaign: {
          name: 'spring_sale',
          source: 'google',
          medium: 'cpc',
          term: 'running shoes',
          content: 'banner_ad',
        },
      }
      expectTypeOf(context.campaign).toMatchTypeOf<{
        name?: string
        source?: string
        medium?: string
        term?: string
        content?: string
      } | undefined>()
    })
  })

  describe('device context', () => {
    it('should support device object', () => {
      const context: EventContext = {
        device: {
          id: 'device-123',
          advertisingId: 'ad-456',
          adTrackingEnabled: true,
          manufacturer: 'Apple',
          model: 'iPhone 15',
          name: "John's iPhone",
          type: 'ios',
          token: 'push-token-789',
        },
      }
      expectTypeOf(context.device).toMatchTypeOf<{
        id?: string
        advertisingId?: string
        adTrackingEnabled?: boolean
        manufacturer?: string
        model?: string
        name?: string
        type?: string
        token?: string
      } | undefined>()
    })
  })

  describe('ip context', () => {
    it('should support ip string', () => {
      const context: EventContext = {
        ip: '192.168.1.1',
      }
      expectTypeOf(context.ip).toMatchTypeOf<string | undefined>()
    })
  })

  describe('library context', () => {
    it('should support library object', () => {
      const context: EventContext = {
        library: {
          name: 'analytics.js',
          version: '2.0.0',
        },
      }
      expectTypeOf(context.library).toMatchTypeOf<{
        name?: string
        version?: string
      } | undefined>()
    })
  })

  describe('locale context', () => {
    it('should support locale string', () => {
      const context: EventContext = {
        locale: 'en-US',
      }
      expectTypeOf(context.locale).toMatchTypeOf<string | undefined>()
    })
  })

  describe('location context', () => {
    it('should support location object', () => {
      const context: EventContext = {
        location: {
          city: 'San Francisco',
          country: 'United States',
          latitude: 37.7749,
          longitude: -122.4194,
          region: 'California',
          speed: 0,
        },
      }
      expectTypeOf(context.location).toMatchTypeOf<{
        city?: string
        country?: string
        latitude?: number
        longitude?: number
        region?: string
        speed?: number
      } | undefined>()
    })
  })

  describe('network context', () => {
    it('should support network object', () => {
      const context: EventContext = {
        network: {
          bluetooth: false,
          carrier: 'Verizon',
          cellular: true,
          wifi: false,
        },
      }
      expectTypeOf(context.network).toMatchTypeOf<{
        bluetooth?: boolean
        carrier?: string
        cellular?: boolean
        wifi?: boolean
      } | undefined>()
    })
  })

  describe('os context', () => {
    it('should support os object', () => {
      const context: EventContext = {
        os: {
          name: 'iOS',
          version: '17.0',
        },
      }
      expectTypeOf(context.os).toMatchTypeOf<{
        name?: string
        version?: string
      } | undefined>()
    })
  })

  describe('page context', () => {
    it('should support page object', () => {
      const context: EventContext = {
        page: {
          path: '/products',
          referrer: 'https://google.com',
          search: '?category=shoes',
          title: 'Products - MyStore',
          url: 'https://mystore.com/products?category=shoes',
        },
      }
      expectTypeOf(context.page).toMatchTypeOf<{
        path?: string
        referrer?: string
        search?: string
        title?: string
        url?: string
      } | undefined>()
    })
  })

  describe('screen context', () => {
    it('should support screen object', () => {
      const context: EventContext = {
        screen: {
          width: 1920,
          height: 1080,
          density: 2,
        },
      }
      expectTypeOf(context.screen).toMatchTypeOf<{
        width?: number
        height?: number
        density?: number
      } | undefined>()
    })
  })

  describe('timezone context', () => {
    it('should support timezone string', () => {
      const context: EventContext = {
        timezone: 'America/Los_Angeles',
      }
      expectTypeOf(context.timezone).toMatchTypeOf<string | undefined>()
    })
  })

  describe('userAgent context', () => {
    it('should support userAgent string', () => {
      const context: EventContext = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      }
      expectTypeOf(context.userAgent).toMatchTypeOf<string | undefined>()
    })
  })

  describe('groupId context', () => {
    it('should support groupId string', () => {
      const context: EventContext = {
        groupId: 'group-123',
      }
      expectTypeOf(context.groupId).toMatchTypeOf<string | undefined>()
    })
  })

  describe('traits context', () => {
    it('should support traits for server-side', () => {
      const context: EventContext = {
        traits: {
          email: 'test@example.com',
          name: 'Test User',
        },
      }
      expectTypeOf(context.traits).toMatchTypeOf<UserTraits | undefined>()
    })
  })
})

// ============================================================================
// PROPERTY OPERATIONS TESTS
// ============================================================================

describe('PropertyOperations', () => {
  it('should support $set operation', () => {
    const ops: PropertyOperations = {
      $set: {
        name: 'John Doe',
        email: 'john@example.com',
      },
    }
    expectTypeOf(ops.$set).toMatchTypeOf<Record<string, unknown> | undefined>()
  })

  it('should support $setOnce operation', () => {
    const ops: PropertyOperations = {
      $setOnce: {
        firstLogin: new Date().toISOString(),
      },
    }
    expectTypeOf(ops.$setOnce).toMatchTypeOf<Record<string, unknown> | undefined>()
  })

  it('should support $add operation (numeric increment)', () => {
    const ops: PropertyOperations = {
      $add: {
        loginCount: 1,
        totalSpent: 99.99,
      },
    }
    expectTypeOf(ops.$add).toMatchTypeOf<Record<string, number> | undefined>()
  })

  it('should support $append operation (add to array)', () => {
    const ops: PropertyOperations = {
      $append: {
        purchasedProducts: 'product-123',
      },
    }
    expectTypeOf(ops.$append).toMatchTypeOf<Record<string, unknown> | undefined>()
  })

  it('should support $prepend operation (prepend to array)', () => {
    const ops: PropertyOperations = {
      $prepend: {
        recentSearches: 'new search',
      },
    }
    expectTypeOf(ops.$prepend).toMatchTypeOf<Record<string, unknown> | undefined>()
  })

  it('should support $unset operation (remove properties)', () => {
    const ops: PropertyOperations = {
      $unset: ['temporaryField', 'deprecatedField'],
    }
    expectTypeOf(ops.$unset).toMatchTypeOf<string[] | undefined>()
  })

  it('should support $remove operation (remove from array)', () => {
    const ops: PropertyOperations = {
      $remove: {
        tags: 'old-tag',
      },
    }
    expectTypeOf(ops.$remove).toMatchTypeOf<Record<string, unknown> | undefined>()
  })
})

// ============================================================================
// EVENT-SPECIFIC INTERFACE TESTS
// ============================================================================

describe('TrackEvent', () => {
  it('should require event name', () => {
    const event: TrackEvent = {
      type: 'track',
      event: 'Product Viewed',
      anonymousId: 'anon-123',
    }
    expectTypeOf(event.event).toBeString()
  })

  it('should support optional properties', () => {
    const event: TrackEvent = {
      type: 'track',
      event: 'Product Viewed',
      anonymousId: 'anon-123',
      properties: {
        productId: 'prod-456',
        price: 99.99,
        category: 'Electronics',
      },
    }
    expectTypeOf(event.properties).toMatchTypeOf<Record<string, unknown> | undefined>()
  })
})

describe('IdentifyEvent', () => {
  it('should require userId for identify', () => {
    const event: IdentifyEvent = {
      type: 'identify',
      userId: 'user-123',
    }
    expectTypeOf(event.userId).toBeString()
  })

  it('should support traits', () => {
    const event: IdentifyEvent = {
      type: 'identify',
      userId: 'user-123',
      traits: {
        email: 'test@example.com',
        name: 'Test User',
      },
    }
    expectTypeOf(event.traits).toMatchTypeOf<UserTraits | undefined>()
  })
})

describe('PageEvent', () => {
  it('should have type page', () => {
    const event: PageEvent = {
      type: 'page',
      anonymousId: 'anon-123',
    }
    expect(event.type).toBe('page')
  })

  it('should support optional category', () => {
    const event: PageEvent = {
      type: 'page',
      anonymousId: 'anon-123',
      category: 'Docs',
    }
    expectTypeOf(event.category).toMatchTypeOf<string | undefined>()
  })

  it('should support optional name', () => {
    const event: PageEvent = {
      type: 'page',
      anonymousId: 'anon-123',
      name: 'Getting Started',
    }
    expectTypeOf(event.name).toMatchTypeOf<string | undefined>()
  })

  it('should support optional properties', () => {
    const event: PageEvent = {
      type: 'page',
      anonymousId: 'anon-123',
      properties: {
        title: 'Home Page',
        url: 'https://example.com',
      },
    }
    expectTypeOf(event.properties).toMatchTypeOf<Record<string, unknown> | undefined>()
  })
})

describe('ScreenEvent', () => {
  it('should have type screen', () => {
    const event: ScreenEvent = {
      type: 'screen',
      anonymousId: 'anon-123',
    }
    expect(event.type).toBe('screen')
  })

  it('should support optional name', () => {
    const event: ScreenEvent = {
      type: 'screen',
      anonymousId: 'anon-123',
      name: 'Home Screen',
    }
    expectTypeOf(event.name).toMatchTypeOf<string | undefined>()
  })

  it('should support optional properties', () => {
    const event: ScreenEvent = {
      type: 'screen',
      anonymousId: 'anon-123',
      properties: {
        screenClass: 'HomeViewController',
      },
    }
    expectTypeOf(event.properties).toMatchTypeOf<Record<string, unknown> | undefined>()
  })
})

describe('GroupEvent', () => {
  it('should require groupId', () => {
    const event: GroupEvent = {
      type: 'group',
      anonymousId: 'anon-123',
      groupId: 'group-456',
    }
    expectTypeOf(event.groupId).toBeString()
  })

  it('should support optional traits', () => {
    const event: GroupEvent = {
      type: 'group',
      anonymousId: 'anon-123',
      groupId: 'group-456',
      traits: {
        name: 'Acme Inc',
        industry: 'Technology',
        employees: 100,
      },
    }
    expectTypeOf(event.traits).toMatchTypeOf<Record<string, unknown> | undefined>()
  })
})

describe('AliasEvent', () => {
  it('should require previousId', () => {
    const event: AliasEvent = {
      type: 'alias',
      userId: 'user-123',
      previousId: 'anon-456',
    }
    expectTypeOf(event.previousId).toBeString()
  })

  it('should require userId', () => {
    const event: AliasEvent = {
      type: 'alias',
      userId: 'user-123',
      previousId: 'anon-456',
    }
    expectTypeOf(event.userId).toBeString()
  })
})

// ============================================================================
// VALIDATOR TESTS
// ============================================================================

describe('isValidAnalyticsEvent', () => {
  it('should return true for valid track event', () => {
    const event = {
      type: 'track',
      event: 'Test Event',
      anonymousId: 'anon-123',
    }
    expect(isValidAnalyticsEvent(event)).toBe(true)
  })

  it('should return true for valid identify event', () => {
    const event = {
      type: 'identify',
      userId: 'user-123',
    }
    expect(isValidAnalyticsEvent(event)).toBe(true)
  })

  it('should return false for missing type', () => {
    const event = {
      event: 'Test Event',
      anonymousId: 'anon-123',
    }
    expect(isValidAnalyticsEvent(event)).toBe(false)
  })

  it('should return false for missing anonymousId and userId', () => {
    const event = {
      type: 'track',
      event: 'Test Event',
    }
    expect(isValidAnalyticsEvent(event)).toBe(false)
  })

  it('should return false for invalid type', () => {
    const event = {
      type: 'invalid',
      anonymousId: 'anon-123',
    }
    expect(isValidAnalyticsEvent(event)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isValidAnalyticsEvent(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isValidAnalyticsEvent(undefined)).toBe(false)
  })
})

describe('isValidUserTraits', () => {
  it('should return true for valid traits object', () => {
    const traits = {
      email: 'test@example.com',
      name: 'Test User',
    }
    expect(isValidUserTraits(traits)).toBe(true)
  })

  it('should return true for empty traits', () => {
    expect(isValidUserTraits({})).toBe(true)
  })

  it('should return false for null', () => {
    expect(isValidUserTraits(null)).toBe(false)
  })

  it('should return false for non-object', () => {
    expect(isValidUserTraits('not an object')).toBe(false)
    expect(isValidUserTraits(123)).toBe(false)
    expect(isValidUserTraits([])).toBe(false)
  })
})

describe('isValidEventContext', () => {
  it('should return true for valid context object', () => {
    const context = {
      ip: '192.168.1.1',
      locale: 'en-US',
    }
    expect(isValidEventContext(context)).toBe(true)
  })

  it('should return true for empty context', () => {
    expect(isValidEventContext({})).toBe(true)
  })

  it('should return false for null', () => {
    expect(isValidEventContext(null)).toBe(false)
  })

  it('should return false for non-object', () => {
    expect(isValidEventContext('not an object')).toBe(false)
  })
})
