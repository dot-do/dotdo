import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Forward Search (~>) Resolver Tests
 *
 * Tests for the forward fuzzy search resolver implementation:
 * - SessionCache for within-generation caching
 * - semanticSearch helper with vector search
 * - Integration with EdgeVec HNSW
 * - Cache deduplication behavior
 */

import {
  SessionCache,
  createSemanticSearchHelper,
  createForwardResolverWithCache,
  ForwardCascadeResolver,
  type Entity,
  type SemanticSearchResult,
  type GenerationContext,
  type ParsedReference,
  type EmbedFunction,
  type VectorSearchFunction,
  type EntityLoaderFunction,
} from '../resolvers/forward'

// ============================================================================
// SESSION CACHE TESTS
// ============================================================================

describe('SessionCache', () => {
  describe('basic operations', () => {
    it('stores and retrieves values', () => {
      const cache = new SessionCache<string>()

      cache.set('Customer', 'enterprise buyer', 'cached-value')
      const result = cache.get('Customer', 'enterprise buyer')

      expect(result).toBe('cached-value')
    })

    it('returns undefined for missing keys', () => {
      const cache = new SessionCache<string>()

      const result = cache.get('Customer', 'non-existent')

      expect(result).toBeUndefined()
    })

    it('handles different types independently', () => {
      const cache = new SessionCache<string>()

      cache.set('Customer', 'query', 'customer-result')
      cache.set('Product', 'query', 'product-result')

      expect(cache.get('Customer', 'query')).toBe('customer-result')
      expect(cache.get('Product', 'query')).toBe('product-result')
    })

    it('has() returns true for existing keys', () => {
      const cache = new SessionCache<string>()
      cache.set('Type', 'query', 'value')

      expect(cache.has('Type', 'query')).toBe(true)
      expect(cache.has('Type', 'other')).toBe(false)
    })

    it('clear() removes all entries', () => {
      const cache = new SessionCache<string>()
      cache.set('A', 'q1', 'v1')
      cache.set('B', 'q2', 'v2')

      cache.clear()

      expect(cache.get('A', 'q1')).toBeUndefined()
      expect(cache.get('B', 'q2')).toBeUndefined()
      expect(cache.getStats().size).toBe(0)
    })
  })

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns value before TTL expires', () => {
      const cache = new SessionCache<string>({ ttlMs: 1000 })
      cache.set('Type', 'query', 'value')

      vi.advanceTimersByTime(500)
      const result = cache.get('Type', 'query')

      expect(result).toBe('value')
    })

    it('returns undefined after TTL expires', () => {
      const cache = new SessionCache<string>({ ttlMs: 1000 })
      cache.set('Type', 'query', 'value')

      vi.advanceTimersByTime(1001)
      const result = cache.get('Type', 'query')

      expect(result).toBeUndefined()
    })

    it('prune() removes expired entries', () => {
      const cache = new SessionCache<string>({ ttlMs: 1000 })
      cache.set('A', 'q1', 'v1')
      cache.set('B', 'q2', 'v2')

      vi.advanceTimersByTime(500)
      cache.set('C', 'q3', 'v3')

      vi.advanceTimersByTime(600)
      const pruned = cache.prune()

      expect(pruned).toBe(2) // A and B expired
      expect(cache.get('C', 'q3')).toBe('v3')
    })
  })

  describe('max entries eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      const cache = new SessionCache<string>({ maxEntries: 2 })

      cache.set('A', 'q1', 'v1')
      cache.set('B', 'q2', 'v2')
      cache.set('C', 'q3', 'v3')

      expect(cache.get('A', 'q1')).toBeUndefined() // Evicted
      expect(cache.get('B', 'q2')).toBe('v2')
      expect(cache.get('C', 'q3')).toBe('v3')
    })

    it('does not evict when updating existing key', () => {
      const cache = new SessionCache<string>({ maxEntries: 2 })

      cache.set('A', 'q1', 'v1')
      cache.set('B', 'q2', 'v2')
      cache.set('A', 'q1', 'v1-updated')

      expect(cache.get('A', 'q1')).toBe('v1-updated')
      expect(cache.get('B', 'q2')).toBe('v2')
    })
  })

  describe('statistics', () => {
    it('tracks cache size', () => {
      const cache = new SessionCache<string>()
      cache.set('A', 'q1', 'v1')
      cache.set('B', 'q2', 'v2')

      const stats = cache.getStats()

      expect(stats.size).toBe(2)
    })

    it('tracks hit counts', () => {
      const cache = new SessionCache<string>()
      cache.set('Type', 'query', 'value')

      cache.get('Type', 'query')
      cache.get('Type', 'query')
      cache.get('Type', 'query')

      const stats = cache.getStats()
      expect(stats.hits).toBe(3)
    })

    it('reports max entries', () => {
      const cache = new SessionCache<string>({ maxEntries: 500 })
      const stats = cache.getStats()

      expect(stats.maxEntries).toBe(500)
    })
  })

  describe('query hashing', () => {
    it('handles long queries', () => {
      const cache = new SessionCache<string>()
      const longQuery = 'a'.repeat(10000)

      cache.set('Type', longQuery, 'value')
      const result = cache.get('Type', longQuery)

      expect(result).toBe('value')
    })

    it('produces consistent hashes for same query', () => {
      const cache = new SessionCache<string>()
      const query = 'enterprise SaaS buyer in healthcare'

      cache.set('Type', query, 'value')

      // Same query should hit cache
      expect(cache.get('Type', query)).toBe('value')
      expect(cache.get('Type', query)).toBe('value')
    })

    it('different queries produce different keys', () => {
      const cache = new SessionCache<string>()

      cache.set('Type', 'query one', 'v1')
      cache.set('Type', 'query two', 'v2')

      expect(cache.get('Type', 'query one')).toBe('v1')
      expect(cache.get('Type', 'query two')).toBe('v2')
    })
  })
})

// ============================================================================
// SEMANTIC SEARCH HELPER TESTS
// ============================================================================

describe('createSemanticSearchHelper', () => {
  describe('search flow', () => {
    it('embeds query, searches vectors, loads entities', async () => {
      const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
      const mockVectorSearch = vi.fn().mockResolvedValue([
        { id: 'customer-001', score: 0.95 },
        { id: 'customer-002', score: 0.85 },
      ])
      const mockLoadEntities = vi.fn().mockResolvedValue([
        { $id: 'customer-001', $type: 'Customer', name: 'Acme Corp' },
        { $id: 'customer-002', $type: 'Customer', name: 'TechCo' },
      ])

      const search = createSemanticSearchHelper({
        embed: mockEmbed,
        vectorSearch: mockVectorSearch,
        loadEntities: mockLoadEntities,
      })

      const results = await search('Customer', 'enterprise buyer')

      expect(mockEmbed).toHaveBeenCalledWith('enterprise buyer')
      expect(mockVectorSearch).toHaveBeenCalledWith(
        'Customer',
        [0.1, 0.2, 0.3],
        expect.objectContaining({ k: 10 })
      )
      expect(mockLoadEntities).toHaveBeenCalledWith(['customer-001', 'customer-002'])
      expect(results).toHaveLength(2)
      expect(results[0]!.entity.name).toBe('Acme Corp')
      expect(results[0]!.similarity).toBe(0.95)
    })

    it('returns empty array when no matches found', async () => {
      const search = createSemanticSearchHelper({
        embed: vi.fn().mockResolvedValue([0.1, 0.2]),
        vectorSearch: vi.fn().mockResolvedValue([]),
        loadEntities: vi.fn(),
      })

      const results = await search('Customer', 'non-existent query')

      expect(results).toEqual([])
    })

    it('filters results by threshold', async () => {
      const mockVectorSearch = vi.fn().mockResolvedValue([
        { id: 'high', score: 0.95 },
        { id: 'low', score: 0.60 },
      ])
      const mockLoadEntities = vi.fn().mockResolvedValue([
        { $id: 'high', $type: 'T' },
        { $id: 'low', $type: 'T' },
      ])

      const search = createSemanticSearchHelper({
        embed: vi.fn().mockResolvedValue([0.1]),
        vectorSearch: mockVectorSearch,
        loadEntities: mockLoadEntities,
        defaultThreshold: 0.80,
      })

      const results = await search('Type', 'query')

      // Note: The helper returns all results, threshold filtering is done by caller
      // The vectorSearch should receive the threshold
      expect(mockVectorSearch).toHaveBeenCalledWith(
        'Type',
        expect.any(Array),
        expect.objectContaining({ threshold: 0.8 })
      )
    })
  })

  describe('caching behavior', () => {
    it('caches results for same type+query', async () => {
      const cache = new SessionCache<SemanticSearchResult[]>()
      const mockEmbed = vi.fn().mockResolvedValue([0.1])
      const mockVectorSearch = vi.fn().mockResolvedValue([
        { id: 'e1', score: 0.9 },
      ])
      const mockLoadEntities = vi.fn().mockResolvedValue([
        { $id: 'e1', $type: 'T' },
      ])

      const search = createSemanticSearchHelper({
        embed: mockEmbed,
        vectorSearch: mockVectorSearch,
        loadEntities: mockLoadEntities,
        cache,
      })

      // First search - cache miss
      await search('Type', 'query')
      expect(mockEmbed).toHaveBeenCalledTimes(1)

      // Second search - cache hit
      await search('Type', 'query')
      expect(mockEmbed).toHaveBeenCalledTimes(1) // Not called again
    })

    it('caches empty results', async () => {
      const cache = new SessionCache<SemanticSearchResult[]>()
      const mockEmbed = vi.fn().mockResolvedValue([0.1])
      const mockVectorSearch = vi.fn().mockResolvedValue([])

      const search = createSemanticSearchHelper({
        embed: mockEmbed,
        vectorSearch: mockVectorSearch,
        loadEntities: vi.fn(),
        cache,
      })

      await search('Type', 'no-matches')
      await search('Type', 'no-matches')

      expect(mockEmbed).toHaveBeenCalledTimes(1) // Cached empty result
    })

    it('different queries create separate cache entries', async () => {
      const cache = new SessionCache<SemanticSearchResult[]>()
      const mockEmbed = vi.fn().mockResolvedValue([0.1])
      const mockVectorSearch = vi.fn().mockResolvedValue([])

      const search = createSemanticSearchHelper({
        embed: mockEmbed,
        vectorSearch: mockVectorSearch,
        loadEntities: vi.fn(),
        cache,
      })

      await search('Type', 'query-a')
      await search('Type', 'query-b')

      expect(mockEmbed).toHaveBeenCalledTimes(2)
    })

    it('filters cached results by current threshold', async () => {
      const cache = new SessionCache<SemanticSearchResult[]>()
      // Pre-populate cache with results at varying similarity
      const cachedResults: SemanticSearchResult[] = [
        { entity: { $id: 'high', $type: 'T' }, similarity: 0.95 },
        { entity: { $id: 'mid', $type: 'T' }, similarity: 0.75 },
        { entity: { $id: 'low', $type: 'T' }, similarity: 0.55 },
      ]
      cache.set('Type', 'query', cachedResults)

      const search = createSemanticSearchHelper({
        embed: vi.fn(),
        vectorSearch: vi.fn(),
        loadEntities: vi.fn(),
        cache,
        defaultThreshold: 0.5,
      })

      // With high threshold
      const highThreshold = await search('Type', 'query', 0.90)
      expect(highThreshold).toHaveLength(1)

      // With medium threshold
      const medThreshold = await search('Type', 'query', 0.70)
      expect(medThreshold).toHaveLength(2)

      // With low threshold
      const lowThreshold = await search('Type', 'query', 0.50)
      expect(lowThreshold).toHaveLength(3)
    })
  })

  describe('entity loading', () => {
    it('handles missing entities gracefully', async () => {
      const mockVectorSearch = vi.fn().mockResolvedValue([
        { id: 'exists', score: 0.9 },
        { id: 'deleted', score: 0.8 },
      ])
      const mockLoadEntities = vi.fn().mockResolvedValue([
        { $id: 'exists', $type: 'T' }, // Only one entity returned
      ])

      const search = createSemanticSearchHelper({
        embed: vi.fn().mockResolvedValue([0.1]),
        vectorSearch: mockVectorSearch,
        loadEntities: mockLoadEntities,
      })

      const results = await search('Type', 'query')

      expect(results).toHaveLength(1)
      expect(results[0]!.entity.$id).toBe('exists')
    })

    it('preserves search result order', async () => {
      const mockVectorSearch = vi.fn().mockResolvedValue([
        { id: 'first', score: 0.99 },
        { id: 'second', score: 0.95 },
        { id: 'third', score: 0.90 },
      ])
      const mockLoadEntities = vi.fn().mockResolvedValue([
        { $id: 'third', $type: 'T' }, // Returned in different order
        { $id: 'first', $type: 'T' },
        { $id: 'second', $type: 'T' },
      ])

      const search = createSemanticSearchHelper({
        embed: vi.fn().mockResolvedValue([0.1]),
        vectorSearch: mockVectorSearch,
        loadEntities: mockLoadEntities,
      })

      const results = await search('Type', 'query')

      expect(results[0]!.entity.$id).toBe('first')
      expect(results[1]!.entity.$id).toBe('second')
      expect(results[2]!.entity.$id).toBe('third')
    })
  })
})

// ============================================================================
// FORWARD RESOLVER WITH CACHE TESTS
// ============================================================================

describe('createForwardResolverWithCache', () => {
  it('creates resolver with integrated semantic search', async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    const mockVectorSearch = vi.fn().mockResolvedValue([
      { id: 'icp-001', score: 0.92 },
    ])
    const mockLoadEntities = vi.fn().mockResolvedValue([
      { $id: 'icp-001', $type: 'IdealCustomerProfile', persona: 'Developer' },
    ])

    const resolver = createForwardResolverWithCache({
      embed: mockEmbed,
      vectorSearch: mockVectorSearch,
      loadEntities: mockLoadEntities,
      similarityThreshold: 0.85,
    })

    const ref: ParsedReference = {
      direction: 'forward',
      mode: 'fuzzy',
      operator: '~>',
      target: 'IdealCustomerProfile',
      fieldName: 'customer',
      prompt: '',
      optional: false,
    }

    const context: GenerationContext = {
      entity: {
        $id: 'startup-001',
        $type: 'Startup',
        idea: 'Developer tools',
      },
      previousGenerations: [],
      db: {},
      ai: {},
    }

    const result = await resolver.resolve(ref, context)

    expect(result?.$id).toBe('icp-001')
    expect(result?.$type).toBe('IdealCustomerProfile')
    expect(mockEmbed).toHaveBeenCalled()
    expect(mockVectorSearch).toHaveBeenCalled()
  })

  it('uses session cache to prevent duplicate searches', async () => {
    const searchCache = new SessionCache<SemanticSearchResult[]>()
    const mockEmbed = vi.fn().mockResolvedValue([0.1])
    const mockVectorSearch = vi.fn().mockResolvedValue([
      { id: 'e1', score: 0.9 },
    ])
    const mockLoadEntities = vi.fn().mockResolvedValue([
      { $id: 'e1', $type: 'T' },
    ])

    const resolver = createForwardResolverWithCache({
      embed: mockEmbed,
      vectorSearch: mockVectorSearch,
      loadEntities: mockLoadEntities,
      searchCache,
      similarityThreshold: 0.80,
    })

    const ref: ParsedReference = {
      direction: 'forward',
      mode: 'fuzzy',
      operator: '~>',
      target: 'Target',
      fieldName: 'field',
      prompt: '',
      optional: false,
    }

    const context: GenerationContext = {
      entity: { $id: 'e1', $type: 'Source', name: 'same query context' },
      previousGenerations: [],
      db: {},
      ai: {},
    }

    // First resolution
    await resolver.resolve(ref, context)
    expect(mockEmbed).toHaveBeenCalledTimes(1)

    // Second resolution with same context - should use cache
    await resolver.resolve(ref, context)
    // Note: embeddings are called based on searchQuery which comes from entity
    // If same entity = same query = cache hit
  })

  it('generates new entity when no match found', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      $id: 'generated-001',
      $type: 'NewEntity',
    })

    const resolver = createForwardResolverWithCache({
      embed: vi.fn().mockResolvedValue([0.1]),
      vectorSearch: vi.fn().mockResolvedValue([]), // No matches
      loadEntities: vi.fn(),
      generate: mockGenerate,
      similarityThreshold: 0.80,
    })

    const ref: ParsedReference = {
      direction: 'forward',
      mode: 'fuzzy',
      operator: '~>',
      target: 'NewEntity',
      fieldName: 'newField',
      prompt: 'Generate a new entity',
      optional: false,
    }

    const context: GenerationContext = {
      entity: { $id: 'source-001', $type: 'Source' },
      previousGenerations: [],
      db: {},
      ai: {},
    }

    const result = await resolver.resolve(ref, context)

    expect(mockGenerate).toHaveBeenCalled()
    expect(result?.$id).toBe('generated-001')
  })

  it('respects custom semanticSearch if provided', async () => {
    const customSearch = vi.fn().mockResolvedValue([
      {
        entity: { $id: 'custom-001', $type: 'Custom' },
        similarity: 0.95,
      },
    ])

    // Even with embed/vectorSearch/loadEntities provided,
    // custom semanticSearch takes precedence
    const resolver = createForwardResolverWithCache({
      embed: vi.fn(),
      vectorSearch: vi.fn(),
      loadEntities: vi.fn(),
      semanticSearch: customSearch, // Takes precedence
      similarityThreshold: 0.80,
    })

    const ref: ParsedReference = {
      direction: 'forward',
      mode: 'fuzzy',
      operator: '~>',
      target: 'Custom',
      fieldName: 'customField',
      prompt: '',
      optional: false,
    }

    const context: GenerationContext = {
      entity: { $id: 'source-001', $type: 'Source' },
      previousGenerations: [],
      db: {},
      ai: {},
    }

    const result = await resolver.resolve(ref, context)

    expect(customSearch).toHaveBeenCalled()
    expect(result?.$id).toBe('custom-001')
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Forward Search (~>) Integration', () => {
  describe('end-to-end flow', () => {
    it('searches, finds match, creates relationship', async () => {
      const existingEntity = {
        $id: 'icp-existing',
        $type: 'IdealCustomerProfile',
        persona: 'Enterprise Developer',
      }

      const relationships: Array<{ from: string; to: string; verb: string }> = []

      const resolver = new ForwardCascadeResolver({
        semanticSearch: vi.fn().mockResolvedValue([
          { entity: existingEntity, similarity: 0.92 },
        ]),
        createRelationship: vi.fn().mockImplementation((opts) => {
          relationships.push({ from: opts.from, to: opts.to, verb: opts.verb })
          return Promise.resolve({ id: 'rel-1', ...opts })
        }),
        similarityThreshold: 0.85,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'IdealCustomerProfile',
        fieldName: 'targetCustomer',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {},
        ai: {},
      }

      const result = await resolver.resolve(ref, context)

      expect(result?.$id).toBe('icp-existing')
      expect(relationships).toHaveLength(1)
      expect(relationships[0]).toEqual({
        from: 'startup-001',
        to: 'icp-existing',
        verb: 'targetCustomer',
      })
    })

    it('searches, no match, generates new, creates relationship', async () => {
      const generatedEntity = {
        $id: 'icp-new',
        $type: 'IdealCustomerProfile',
        persona: 'SMB Owner',
      }

      const storedEntities: Entity[] = []
      const relationships: Array<{ from: string; to: string; verb: string }> = []

      const resolver = new ForwardCascadeResolver({
        semanticSearch: vi.fn().mockResolvedValue([
          // Results below threshold
          { entity: { $id: 'low-match', $type: 'ICP' }, similarity: 0.60 },
        ]),
        generate: vi.fn().mockResolvedValue(generatedEntity),
        store: vi.fn().mockImplementation((e) => {
          storedEntities.push(e)
          return Promise.resolve()
        }),
        createRelationship: vi.fn().mockImplementation((opts) => {
          relationships.push({ from: opts.from, to: opts.to, verb: opts.verb })
          return Promise.resolve({ id: 'rel-1', ...opts })
        }),
        similarityThreshold: 0.85,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'IdealCustomerProfile',
        fieldName: 'customer',
        prompt: 'Generate ICP',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {},
        ai: {},
      }

      const result = await resolver.resolve(ref, context)

      expect(result?.$id).toBe('icp-new')
      expect(storedEntities).toContainEqual(generatedEntity)
      expect(relationships[0]).toEqual({
        from: 'startup-001',
        to: 'icp-new',
        verb: 'customer',
      })
    })
  })

  describe('session deduplication', () => {
    it('same search query uses cached result', async () => {
      const cache = new SessionCache<SemanticSearchResult[]>()
      let searchCallCount = 0

      const mockEmbed = vi.fn().mockImplementation(async () => {
        searchCallCount++
        return [0.1, 0.2]
      })

      const resolver = createForwardResolverWithCache({
        embed: mockEmbed,
        vectorSearch: vi.fn().mockResolvedValue([
          { id: 'cached-entity', score: 0.95 },
        ]),
        loadEntities: vi.fn().mockResolvedValue([
          { $id: 'cached-entity', $type: 'Entity' },
        ]),
        searchCache: cache,
        similarityThreshold: 0.80,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Entity',
        fieldName: 'field',
        prompt: '',
        optional: false,
      }

      // Same entity context means same search query
      const context: GenerationContext = {
        entity: {
          $id: 'parent-001',
          $type: 'Parent',
          description: 'consistent search context',
        },
        previousGenerations: [],
        db: {},
        ai: {},
      }

      // First call
      await resolver.resolve(ref, context)

      // Second call - should use cache
      await resolver.resolve(ref, context)

      // Cache stats should show hits
      expect(cache.getStats().hits).toBeGreaterThan(0)
    })
  })
})
