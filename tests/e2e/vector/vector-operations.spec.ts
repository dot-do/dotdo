/**
 * E2E Tests: VectorManager Operations
 *
 * Tests vector insert, search, and delete operations through the
 * DO REST API with mock backends. These tests verify that vector
 * operations work correctly when accessed through HTTP endpoints
 * backed by Durable Objects.
 *
 * Tests include:
 * - Insert operations (single and batch)
 * - Search operations with different strategies
 * - Delete operations
 * - Filter and threshold support
 * - Metadata handling
 *
 * @module tests/e2e/vector/vector-operations.spec
 */

import { test, expect } from '@playwright/test'

/**
 * API endpoint for vector operations.
 * In production, this would be something like vector.tenant.api.dotdo.dev
 * For E2E testing, we use the local dev server.
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
    vec.push(Math.random() * 2 - 1) // Values between -1 and 1
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

test.describe('Vector Operations - Insert', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('inserts a single vector with metadata', async ({ request }) => {
    const vectorId = uniqueId('vec')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {
          label: 'test',
          category: 'embeddings',
          timestamp: Date.now(),
        },
      },
    })

    expect(response.status()).toBe(201)
    const result = await response.json()

    expect(result.id).toBe(vectorId)
    expect(result.success).toBe(true)
  })

  test('inserts vector into specific tier', async ({ request }) => {
    const vectorId = uniqueId('vec-tier')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { tier: 'warm' },
        tier: 'warm',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('batch inserts multiple vectors', async ({ request }) => {
    const prefix = uniqueId('batch')
    const vectors = []

    for (let i = 0; i < 10; i++) {
      vectors.push({
        id: `${prefix}-${i}`,
        vector: normalizeVector(randomVector(128)),
        metadata: { index: i, batch: prefix },
      })
    }

    const response = await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })

    expect(response.status()).toBe(201)
    const result = await response.json()

    expect(result.inserted).toBe(10)
  })

  test('rejects vector with wrong dimensions', async ({ request }) => {
    const vectorId = uniqueId('wrong-dims')
    const vector = randomVector(64) // Should be 128

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
      },
    })

    // API should reject dimension mismatch
    expect(response.status()).toBe(400)
  })

  test('handles empty metadata', async ({ request }) => {
    const vectorId = uniqueId('no-meta')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
      },
    })

    expect(response.status()).toBe(201)
  })

  test('auto-generates ID if not provided', async ({ request }) => {
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        vector,
        metadata: { autoId: true },
      },
    })

    expect(response.status()).toBe(201)
    const result = await response.json()

    expect(result.id).toBeDefined()
    expect(result.id.length).toBeGreaterThan(0)
  })
})

test.describe('Vector Operations - Search', () => {
  let testPrefix: string
  let baseVector: number[]

  test.beforeAll(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    if (!available) return

    // Create test vectors for search tests
    testPrefix = uniqueId('search')
    baseVector = normalizeVector(randomVector(128))

    // Insert a base vector and similar vectors
    const vectors = [
      {
        id: `${testPrefix}-base`,
        vector: baseVector,
        metadata: { type: 'base', category: 'A' },
      },
      {
        id: `${testPrefix}-similar-1`,
        vector: similarVector(baseVector, 0.1),
        metadata: { type: 'similar', category: 'A' },
      },
      {
        id: `${testPrefix}-similar-2`,
        vector: similarVector(baseVector, 0.2),
        metadata: { type: 'similar', category: 'B' },
      },
      {
        id: `${testPrefix}-different`,
        vector: normalizeVector(randomVector(128)),
        metadata: { type: 'different', category: 'C' },
      },
    ]

    await request.post(`${VECTOR_API}/vectors/batch`, {
      data: { vectors },
    })
  })

  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('searches for similar vectors', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    expect(Array.isArray(result.hits)).toBe(true)
    expect(result.hits.length).toBeGreaterThan(0)

    // Base vector should be most similar to itself
    const topHit = result.hits[0]
    expect(topHit.score).toBeGreaterThan(0.9)
  })

  test('respects limit parameter', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 2,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits.length).toBeLessThanOrEqual(2)
  })

  test('filters by metadata', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        filter: { category: 'A' },
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // All results should have category: 'A'
    for (const hit of result.hits) {
      expect(hit.metadata.category).toBe('A')
    }
  })

  test('applies score threshold', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        threshold: 0.8,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // All results should have score >= threshold
    for (const hit of result.hits) {
      expect(hit.score).toBeGreaterThanOrEqual(0.8)
    }
  })

  test('includes vectors when requested', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        includeVectors: true,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // Each hit should have the vector included
    for (const hit of result.hits) {
      expect(hit.vector).toBeDefined()
      expect(Array.isArray(hit.vector)).toBe(true)
    }
  })

  test('excludes vectors by default', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    // Vectors should not be included by default
    for (const hit of result.hits) {
      expect(hit.vector).toBeUndefined()
    }
  })

  test('searches specific tier', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 10,
        tier: 'hot',
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
  })

  test('returns empty array for no matches', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: randomVector(128),
        limit: 10,
        threshold: 0.99, // Very high threshold
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
    expect(Array.isArray(result.hits)).toBe(true)
  })
})

test.describe('Vector Operations - Delete', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('deletes a vector by ID', async ({ request }) => {
    // First insert a vector
    const vectorId = uniqueId('delete-test')
    const vector = normalizeVector(randomVector(128))

    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { toDelete: true },
      },
    })

    // Delete it
    const deleteResponse = await request.delete(`${VECTOR_API}/vectors/${vectorId}`)
    expect(deleteResponse.status()).toBe(204)

    // Verify it's gone
    const getResponse = await request.get(`${VECTOR_API}/vectors/${vectorId}`)
    expect(getResponse.status()).toBe(404)
  })

  test('deletes from specific tier', async ({ request }) => {
    const vectorId = uniqueId('delete-tier')
    const vector = normalizeVector(randomVector(128))

    // Insert into warm tier
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        tier: 'warm',
      },
    })

    // Delete from warm tier
    const response = await request.delete(`${VECTOR_API}/vectors/${vectorId}?tier=warm`)
    expect(response.status()).toBe(204)
  })

  test('deletes from all tiers', async ({ request }) => {
    const vectorId = uniqueId('delete-all')
    const vector = normalizeVector(randomVector(128))

    // Insert
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
      },
    })

    // Delete from all tiers
    const response = await request.delete(`${VECTOR_API}/vectors/${vectorId}?all=true`)
    expect(response.status()).toBe(204)
  })

  test('returns 404 for non-existent vector', async ({ request }) => {
    const response = await request.delete(`${VECTOR_API}/vectors/non-existent-${Date.now()}`)
    expect(response.status()).toBe(404)
  })
})

test.describe('Vector Operations - Retrieval', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('retrieves vector by ID', async ({ request }) => {
    const vectorId = uniqueId('get-test')
    const vector = normalizeVector(randomVector(128))
    const metadata = { key: 'value', number: 42 }

    // Insert
    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata,
      },
    })

    // Retrieve
    const response = await request.get(`${VECTOR_API}/vectors/${vectorId}`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.id).toBe(vectorId)
    expect(result.metadata.key).toBe('value')
    expect(result.metadata.number).toBe(42)
  })

  test('returns 404 for non-existent vector', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/vectors/non-existent-${Date.now()}`)
    expect(response.status()).toBe(404)
  })

  test('retrieves vector with includeVector option', async ({ request }) => {
    const vectorId = uniqueId('get-with-vec')
    const vector = normalizeVector(randomVector(128))

    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
      },
    })

    const response = await request.get(`${VECTOR_API}/vectors/${vectorId}?includeVector=true`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.vector).toBeDefined()
    expect(result.vector.length).toBe(128)
  })
})

test.describe('Vector Operations - Count', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('returns count for specific tier', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/count?tier=hot`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(typeof result.count).toBe('number')
    expect(result.count).toBeGreaterThanOrEqual(0)
  })

  test('returns total count across all tiers', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/count`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(typeof result.count).toBe('number')
  })
})
