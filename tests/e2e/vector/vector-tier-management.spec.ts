/**
 * E2E Tests: VectorManager Tier Management
 *
 * Tests tier promotion and demotion operations for the VectorManager.
 * These tests verify that vectors can be moved between hot, warm,
 * and cold tiers correctly.
 *
 * Tests include:
 * - Promoting vectors from hot to warm tier
 * - Demoting vectors from warm to cold tier
 * - Verifying tier state after promotion/demotion
 * - Error handling for missing tiers
 *
 * @module tests/e2e/vector/vector-tier-management.spec
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

/**
 * Check if multi-tier support is available
 */
async function isMultiTierAvailable(request: any): Promise<boolean> {
  try {
    const response = await request.get(`${VECTOR_API}/tiers`)
    if (!response.ok()) return false
    const result = await response.json()
    // Need at least 2 tiers configured
    return result.tiers && result.tiers.length >= 2
  } catch {
    return false
  }
}

test.describe('Tier Promotion - Hot to Warm', () => {
  test.beforeEach(async ({ request }) => {
    const apiAvailable = await isVectorApiAvailable(request)
    const multiTier = await isMultiTierAvailable(request)
    test.skip(!apiAvailable || !multiTier, 'Multi-tier vector API not available')
  })

  test('promotes vector from hot to warm tier', async ({ request }) => {
    const vectorId = uniqueId('promote-hot-warm')
    const vector = normalizeVector(randomVector(128))
    const metadata = { promoted: false, originalTier: 'hot' }

    // Insert into hot tier
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata,
        tier: 'hot',
      },
    })

    // Verify it's in hot tier
    const hotResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=hot`)
    expect(hotResponse.ok()).toBe(true)

    // Promote to warm tier
    const promoteResponse = await request.post(`${VECTOR_API}/vectors/${vectorId}/promote`, {
      data: {
        from: 'hot',
        to: 'warm',
      },
    })

    expect(promoteResponse.ok()).toBe(true)

    // Verify it's now in warm tier
    const warmResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=warm`)
    expect(warmResponse.ok()).toBe(true)

    // Verify it's no longer in hot tier
    const hotCheckResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=hot`)
    expect(hotCheckResponse.status()).toBe(404)
  })

  test('preserves vector data during promotion', async ({ request }) => {
    const vectorId = uniqueId('promote-preserve')
    const vector = normalizeVector(randomVector(128))
    const metadata = { important: 'data', number: 123 }

    // Insert into hot tier
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata,
        tier: 'hot',
      },
    })

    // Promote to warm tier
    await request.post(`${VECTOR_API}/vectors/${vectorId}/promote`, {
      data: {
        from: 'hot',
        to: 'warm',
      },
    })

    // Verify metadata is preserved
    const response = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=warm&includeVector=true`)
    expect(response.ok()).toBe(true)

    const result = await response.json()
    expect(result.metadata.important).toBe('data')
    expect(result.metadata.number).toBe(123)
    expect(result.vector).toBeDefined()
    expect(result.vector.length).toBe(128)
  })

  test('returns error when source vector not found', async ({ request }) => {
    const vectorId = uniqueId('promote-not-found')

    const response = await request.post(`${VECTOR_API}/vectors/${vectorId}/promote`, {
      data: {
        from: 'hot',
        to: 'warm',
      },
    })

    expect(response.status()).toBe(404)
  })

  test('returns error for missing source tier', async ({ request }) => {
    const vectorId = uniqueId('promote-wrong-source')
    const vector = normalizeVector(randomVector(128))

    // Insert into hot tier
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        tier: 'hot',
      },
    })

    // Try to promote from warm (where it doesn't exist)
    const response = await request.post(`${VECTOR_API}/vectors/${vectorId}/promote`, {
      data: {
        from: 'warm',
        to: 'cold',
      },
    })

    expect(response.status()).toBe(404)
  })
})

test.describe('Tier Demotion - Warm to Cold', () => {
  test.beforeEach(async ({ request }) => {
    const apiAvailable = await isVectorApiAvailable(request)
    const multiTier = await isMultiTierAvailable(request)
    test.skip(!apiAvailable || !multiTier, 'Multi-tier vector API not available')
  })

  test('demotes vector from warm to cold tier', async ({ request }) => {
    const vectorId = uniqueId('demote-warm-cold')
    const vector = normalizeVector(randomVector(128))

    // Insert into warm tier
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { tier: 'warm' },
        tier: 'warm',
      },
    })

    // Demote to cold tier
    const demoteResponse = await request.post(`${VECTOR_API}/vectors/${vectorId}/demote`, {
      data: {
        from: 'warm',
        to: 'cold',
      },
    })

    expect(demoteResponse.ok()).toBe(true)

    // Verify it's now in cold tier
    const coldResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=cold`)
    expect(coldResponse.ok()).toBe(true)

    // Verify it's no longer in warm tier
    const warmCheckResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=warm`)
    expect(warmCheckResponse.status()).toBe(404)
  })

  test('demotes vector from hot to cold (skip warm)', async ({ request }) => {
    const vectorId = uniqueId('demote-hot-cold')
    const vector = normalizeVector(randomVector(128))

    // Insert into hot tier
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        tier: 'hot',
      },
    })

    // Demote directly to cold tier
    const demoteResponse = await request.post(`${VECTOR_API}/vectors/${vectorId}/demote`, {
      data: {
        from: 'hot',
        to: 'cold',
      },
    })

    expect(demoteResponse.ok()).toBe(true)

    // Verify it's in cold tier
    const coldResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}?tier=cold`)
    expect(coldResponse.ok()).toBe(true)
  })
})

test.describe('Tier Configuration', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('returns available tiers', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/tiers`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.tiers).toBeDefined()
    expect(Array.isArray(result.tiers)).toBe(true)
    expect(result.tiers.length).toBeGreaterThan(0)

    // Each tier should have expected properties
    for (const tier of result.tiers) {
      expect(tier.name).toBeDefined()
      expect(['hot', 'warm', 'cold']).toContain(tier.name)
      expect(tier.engine).toBeDefined()
      expect(tier.dimensions).toBeDefined()
    }
  })

  test('returns tier-specific count', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/count?tier=hot`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(typeof result.count).toBe('number')
    expect(result.tier).toBe('hot')
  })
})

test.describe('Cross-Tier Search', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    testPrefix = uniqueId('cross-tier')
    baseVector = normalizeVector(randomVector(128))

    // Insert vectors into different tiers
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: `${testPrefix}-hot`,
        vector: baseVector,
        metadata: { tier: 'hot', similarity: 'base' },
        tier: 'hot',
      },
    })

    // Try to insert into warm tier if available
    try {
      await request.post(`${VECTOR_API}/vectors`, {
        data: {
          id: `${testPrefix}-warm`,
          vector: normalizeVector(baseVector.map((x, i) => x + (i % 2 === 0 ? 0.1 : -0.1))),
          metadata: { tier: 'warm', similarity: 'similar' },
          tier: 'warm',
        },
      })
    } catch {
      // Warm tier may not be available
    }
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('cascade search falls back through tiers', async ({ request }) => {
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
  })

  test('parallel search queries all tiers', async ({ request }) => {
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
    // Parallel search may return more results from multiple tiers
  })

  test('smart search selects optimal tier', async ({ request }) => {
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
    // Smart search should include tier selection info
    if (result.metadata) {
      expect(result.metadata.selectedTier).toBeDefined()
    }
  })
})

test.describe('Tier Metrics', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('returns tier statistics', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/stats`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.stats).toBeDefined()
    expect(result.stats.totalVectors).toBeDefined()

    if (result.stats.byTier) {
      for (const tier of Object.keys(result.stats.byTier)) {
        expect(['hot', 'warm', 'cold']).toContain(tier)
        expect(typeof result.stats.byTier[tier].count).toBe('number')
      }
    }
  })
})
