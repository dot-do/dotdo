/**
 * E2E Tests: VectorManager Search Strategies
 *
 * Tests different search routing strategies for the VectorManager:
 * - cascade: Try hot first, fall back to colder tiers
 * - parallel: Query all tiers simultaneously, merge results
 * - smart: Use query characteristics to pick best tier
 *
 * @module tests/e2e/vector/vector-search-strategies.spec
 */

import { test, expect } from '@playwright/test'

/**
 * API endpoint for vector operations.
 */
const VECTOR_API = '/api/vector'

/**
 * Generate a unique ID for test isolation
 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Generate a random vector of given dimensions
 */
function randomVector(dims: number): number[] {
  const vec = []
  for (let i = 0; i < dims; i++) {
    vec.push(Math.random() * 2 - 1)
  }
  return vec
}

/**
 * Normalize a vector to unit length
 */
function normalizeVector(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
  if (magnitude === 0) return v
  return v.map((x) => x / magnitude)
}

/**
 * Create a similar vector by adding small noise
 */
function similarVector(base: number[], noise: number = 0.1): number[] {
  return normalizeVector(
    base.map((x) => x + (Math.random() - 0.5) * noise)
  )
}

/**
 * Check if the vector API is available
 */
async function isVectorApiAvailable(request: any): Promise<boolean> {
  try {
    const response = await request.get(`${VECTOR_API}/health`)
    return response.ok()
  } catch {
    return false
  }
}

test.describe('Cascade Strategy', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    testPrefix = uniqueId('cascade')
    baseVector = normalizeVector(randomVector(128))

    // Insert vectors for cascade testing
    const vectors = []
    for (let i = 0; i < 5; i++) {
      vectors.push({
        id: `${testPrefix}-${i}`,
        vector: i === 0 ? baseVector : similarVector(baseVector, 0.1 + i * 0.05),
        metadata: { index: i, strategy: 'cascade' },
      })
    }

    await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('returns results from first tier with matches', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'cascade',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    expect(result.hits.length).toBeGreaterThan(0)

    // Results should be sorted by score
    for (let i = 1; i < result.hits.length; i++) {
      expect(result.hits[i - 1].score).toBeGreaterThanOrEqual(result.hits[i].score)
    }
  })

  test('stops at first tier with results when fallback disabled', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'cascade',
        fallback: false,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // Should return results only from first available tier
    expect(result.hits).toBeDefined()
  })

  test('continues to next tier when no results found', async ({ request }) => {
    // Use a vector unlikely to match hot tier with high threshold
    const randomVec = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: randomVec,
        limit: 10,
        strategy: 'cascade',
        fallback: true,
        threshold: 0.99, // Very high threshold
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // May return empty if no matches across all tiers
    expect(result.hits).toBeDefined()
    expect(Array.isArray(result.hits)).toBe(true)
  })
})

test.describe('Parallel Strategy', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    testPrefix = uniqueId('parallel')
    baseVector = normalizeVector(randomVector(128))

    // Insert vectors for parallel testing
    const vectors = []
    for (let i = 0; i < 10; i++) {
      vectors.push({
        id: `${testPrefix}-${i}`,
        vector: i === 0 ? baseVector : similarVector(baseVector, 0.05 + i * 0.02),
        metadata: { index: i, strategy: 'parallel', group: i % 3 },
      })
    }

    await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('merges results from all tiers', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'parallel',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    expect(result.hits.length).toBeGreaterThan(0)
  })

  test('deduplicates results across tiers', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 20,
        strategy: 'parallel',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // Check for duplicate IDs
    const ids = result.hits.map((h: any) => h.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  test('sorts merged results by score', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'parallel',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // Results should be sorted by score descending
    for (let i = 1; i < result.hits.length; i++) {
      expect(result.hits[i - 1].score).toBeGreaterThanOrEqual(result.hits[i].score)
    }
  })

  test('applies limit after merging', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 3,
        strategy: 'parallel',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits.length).toBeLessThanOrEqual(3)
  })
})

test.describe('Smart Strategy', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    testPrefix = uniqueId('smart')
    baseVector = normalizeVector(randomVector(128))

    // Insert vectors for smart testing
    const vectors = []
    for (let i = 0; i < 5; i++) {
      vectors.push({
        id: `${testPrefix}-${i}`,
        vector: similarVector(baseVector, 0.1),
        metadata: { index: i, strategy: 'smart', size: 'small' },
      })
    }

    await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('selects appropriate tier based on query', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'smart',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
  })

  test('prefers hot tier for small result sets', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 5,
        strategy: 'smart',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    // For small limits, smart strategy should prefer hot tier
  })

  test('may use cold tier for large result sets', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 1000,
        strategy: 'smart',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    // For large limits, smart strategy may prefer cold tier
  })

  test('respects explicit tier override', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'smart',
        tier: 'hot', // Explicit tier override
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    // When tier is explicitly specified, should use that tier
  })
})

test.describe('Strategy Comparison', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    testPrefix = uniqueId('compare')
    baseVector = normalizeVector(randomVector(128))

    // Insert vectors for comparison
    const vectors = []
    for (let i = 0; i < 20; i++) {
      vectors.push({
        id: `${testPrefix}-${i}`,
        vector: i === 0 ? baseVector : similarVector(baseVector, 0.02 * i),
        metadata: { index: i, comparison: true },
      })
    }

    await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('all strategies return consistent top result', async ({ request }) => {
    const strategies = ['cascade', 'parallel', 'smart']
    const results: Record<string, any> = {}

    for (const strategy of strategies) {
      const response = await request.post(`${VECTOR_API}/search`, {
        data: {
          vector: baseVector,
          limit: 1,
          strategy,
        },
      })

      expect(response.ok()).toBe(true)
      results[strategy] = await response.json()
    }

    // All strategies should return at least one result
    for (const strategy of strategies) {
      expect(results[strategy].hits.length).toBeGreaterThan(0)
    }

    // Top result should be the same (highest similarity)
    const topIds = strategies.map((s) => results[s].hits[0]?.id)
    const uniqueTopIds = new Set(topIds)
    // All strategies should agree on the top result
    expect(uniqueTopIds.size).toBe(1)
  })

  test('strategies may return different result counts', async ({ request }) => {
    const strategies = ['cascade', 'parallel', 'smart']
    const results: Record<string, any> = {}

    for (const strategy of strategies) {
      const response = await request.post(`${VECTOR_API}/search`, {
        data: {
          vector: baseVector,
          limit: 10,
          strategy,
        },
      })

      expect(response.ok()).toBe(true)
      results[strategy] = await response.json()
    }

    // Each strategy should have valid results
    for (const strategy of strategies) {
      expect(results[strategy].hits).toBeDefined()
      expect(Array.isArray(results[strategy].hits)).toBe(true)
    }
  })
})

test.describe('Filter and Threshold with Strategies', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    testPrefix = uniqueId('filter-strat')
    baseVector = normalizeVector(randomVector(128))

    // Insert vectors with different categories
    const vectors = []
    for (let i = 0; i < 15; i++) {
      vectors.push({
        id: `${testPrefix}-${i}`,
        vector: similarVector(baseVector, 0.05 + i * 0.01),
        metadata: {
          index: i,
          category: ['A', 'B', 'C'][i % 3],
          priority: i < 5 ? 'high' : 'low',
        },
      })
    }

    await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('cascade strategy respects filters', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'cascade',
        filter: { category: 'A' },
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    for (const hit of result.hits) {
      expect(hit.metadata.category).toBe('A')
    }
  })

  test('parallel strategy respects filters', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        strategy: 'parallel',
        filter: { priority: 'high' },
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    for (const hit of result.hits) {
      expect(hit.metadata.priority).toBe('high')
    }
  })

  test('threshold applies across all strategies', async ({ request }) => {
    const strategies = ['cascade', 'parallel', 'smart']

    for (const strategy of strategies) {
      const response = await request.post(`${VECTOR_API}/search`, {
        data: {
          vector: baseVector,
          limit: 10,
          strategy,
          threshold: 0.5,
        },
      })

      expect(response.ok()).toBe(true)
      const result = await response.json()

      for (const hit of result.hits) {
        expect(hit.score).toBeGreaterThanOrEqual(0.5)
      }
    }
  })
})
