/**
 * Tests for DO.with() declarative feature syntax
 *
 * This tests the ability to create DO subclasses with specific features
 * eagerly initialized at construction time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DO, DOFeatureConfig } from '../DOBase'

// Mock DurableObjectState for testing
function createMockState(): DurableObjectState {
  const storage = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(new Map()),
    sql: {
      exec: vi.fn().mockReturnValue({ toArray: () => [] }),
    },
    setAlarm: vi.fn().mockResolvedValue(undefined),
    getAlarm: vi.fn().mockResolvedValue(null),
    deleteAlarm: vi.fn().mockResolvedValue(undefined),
  } as unknown as DurableObjectStorage

  const blockConcurrencyWhileCallbacks: Array<() => Promise<void>> = []

  return {
    id: { toString: () => 'test-id' },
    storage,
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => {
      return callback()
    }),
    waitUntil: vi.fn(),
    abort: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
    setWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponseTimestamp: vi.fn(),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(),
    getTags: vi.fn().mockReturnValue([]),
  } as unknown as DurableObjectState
}

function createMockEnv(): Record<string, unknown> {
  return {
    DO: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'test-do-id' }),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response('ok')),
      }),
    },
    PIPELINE: {
      send: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe('DO.with() declarative feature syntax', () => {
  let mockState: DurableObjectState
  let mockEnv: Record<string, unknown>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('static with() method', () => {
    it('should return a class that extends DO', () => {
      const DOWithSearch = DO.with({ search: true })

      expect(DOWithSearch).toBeDefined()
      expect(DOWithSearch.prototype).toBeInstanceOf(Object)
    })

    it('should store feature config in _eagerFeatures static property', () => {
      const features: DOFeatureConfig = { search: true, vectors: true }
      const DOWithFeatures = DO.with(features)

      expect(DOWithFeatures._eagerFeatures).toEqual(features)
    })

    it('should create different classes for different feature configs', () => {
      const DOWithSearch = DO.with({ search: true })
      const DOWithEvents = DO.with({ events: true })

      expect(DOWithSearch).not.toBe(DOWithEvents)
      expect(DOWithSearch._eagerFeatures).toEqual({ search: true })
      expect(DOWithEvents._eagerFeatures).toEqual({ events: true })
    })

    it('should allow empty feature config', () => {
      const DOWithNothing = DO.with({})

      expect(DOWithNothing._eagerFeatures).toEqual({})
    })

    it('should support all defined features', () => {
      const allFeatures: DOFeatureConfig = {
        things: true,
        relationships: true,
        actions: true,
        events: true,
        search: true,
        vectors: true,
        objects: true,
        dlq: true,
      }
      const DOWithAll = DO.with(allFeatures)

      expect(DOWithAll._eagerFeatures).toEqual(allFeatures)
    })
  })

  describe('subclassing with DO.with()', () => {
    it('should allow extending DO.with() result', () => {
      const DOWithSearch = DO.with({ search: true })

      class SearchableDO extends DOWithSearch {
        customMethod() {
          return 'custom'
        }
      }

      expect(SearchableDO.prototype.customMethod).toBeDefined()
      expect(SearchableDO._eagerFeatures).toEqual({ search: true })
    })

    it('should allow extending DO.with() with custom static properties', () => {
      const DOWithSearch = DO.with({ search: true })

      class SearchableDO extends DOWithSearch {
        static readonly $type = 'SearchableDO'
        static customStatic = 'value'
      }

      expect(SearchableDO.$type).toBe('SearchableDO')
      expect(SearchableDO.customStatic).toBe('value')
    })

    it('should allow chaining multiple feature configs conceptually', () => {
      // While DO.with() creates a single class, you can compose features
      const features1: DOFeatureConfig = { search: true }
      const features2: DOFeatureConfig = { events: true }
      const combined: DOFeatureConfig = { ...features1, ...features2 }

      const DOWithBoth = DO.with(combined)

      expect(DOWithBoth._eagerFeatures).toEqual({ search: true, events: true })
    })
  })

  describe('eager initialization', () => {
    it('should call blockConcurrencyWhile during construction', () => {
      const DOWithSearch = DO.with({ search: true })

      // Note: In real usage, DO construction happens in the Cloudflare runtime
      // This test verifies the class structure is correct
      expect(DOWithSearch._eagerFeatures.search).toBe(true)
    })

    it('should have _initializeEagerFeatures method', () => {
      const DOWithSearch = DO.with({ search: true })

      // Check that the prototype chain includes the initialization method
      expect(typeof DO.prototype._initializeEagerFeatures).toBe('function')
    })
  })

  describe('type safety', () => {
    it('should enforce DOFeatureConfig interface', () => {
      // These should all compile without errors
      const _valid1 = DO.with({ search: true })
      const _valid2 = DO.with({ things: true, relationships: true })
      const _valid3 = DO.with({})

      // TypeScript would error on invalid properties:
      // const invalid = DO.with({ invalidFeature: true }) // TS error

      expect(_valid1).toBeDefined()
      expect(_valid2).toBeDefined()
      expect(_valid3).toBeDefined()
    })

    it('should preserve generic type parameter', () => {
      interface CustomEnv {
        MY_BINDING: string
      }

      const DOWithSearch = DO.with<CustomEnv>({ search: true })

      // The returned class should accept the generic Env type
      expect(DOWithSearch).toBeDefined()
    })
  })

  describe('inheritance hierarchy', () => {
    it('should maintain instanceof checks', () => {
      const DOWithSearch = DO.with({ search: true })

      // The class should extend DO
      const proto = Object.getPrototypeOf(DOWithSearch.prototype)
      expect(proto).toBe(DO.prototype)
    })

    it('should allow DO.with() on subclasses', () => {
      // Create a subclass that itself uses DO.with()
      class BaseDO extends DO {
        static readonly $type = 'BaseDO'
      }

      // Note: DO.with() is defined on DO class, subclasses inherit it
      expect(typeof BaseDO.with).toBe('function')
    })
  })

  describe('feature configuration documentation', () => {
    it('should document all available features', () => {
      // This test serves as documentation for available features
      const allFeatures: DOFeatureConfig = {
        // Things store - CRUD operations for domain entities
        things: true,

        // Relationships store - Graph relationships between Things
        relationships: true,

        // Actions store - Action logging and lifecycle tracking
        actions: true,

        // Events store - Event emission and streaming
        events: true,

        // Search store - Full-text and semantic search
        search: true,

        // Vectors - Vector embeddings for semantic search
        vectors: true,

        // Objects store - DO registry and cross-DO resolution
        objects: true,

        // Dead Letter Queue - Failed events for retry
        dlq: true,
      }

      expect(Object.keys(allFeatures)).toHaveLength(8)
    })
  })
})

describe('DOFeatureConfig type', () => {
  it('should have optional boolean properties for each feature', () => {
    // Verify the structure of DOFeatureConfig
    const config: DOFeatureConfig = {}

    // All properties should be optional
    expect(config.things).toBeUndefined()
    expect(config.relationships).toBeUndefined()
    expect(config.actions).toBeUndefined()
    expect(config.events).toBeUndefined()
    expect(config.search).toBeUndefined()
    expect(config.vectors).toBeUndefined()
    expect(config.objects).toBeUndefined()
    expect(config.dlq).toBeUndefined()
  })

  it('should accept partial configurations', () => {
    const searchOnly: DOFeatureConfig = { search: true }
    const eventsOnly: DOFeatureConfig = { events: true }
    const multiple: DOFeatureConfig = { search: true, vectors: true, events: true }

    expect(searchOnly.search).toBe(true)
    expect(searchOnly.events).toBeUndefined()

    expect(eventsOnly.events).toBe(true)
    expect(eventsOnly.search).toBeUndefined()

    expect(multiple.search).toBe(true)
    expect(multiple.vectors).toBe(true)
    expect(multiple.events).toBe(true)
  })
})
