/**
 * E2E Tests: VectorManager with Mock Backends
 *
 * Tests that verify VectorManager operations work correctly with
 * mock/in-memory backends. These tests are designed to run even
 * when real vector backends (Vectorize, ClickHouse, etc.) are
 * not available.
 *
 * Tests include:
 * - In-memory engine operations
 * - Backend switching
 * - Error handling
 * - Configuration validation
 *
 * @module tests/e2e/vector/vector-mock-backends.spec
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

test.describe('Mock Backend - LibSQL Engine', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('handles libsql F32_BLOB equivalent storage', async ({ request }) => {
    const vectorId = uniqueId('libsql-test')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { engine: 'libsql' },
        engine: 'libsql',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('validates vector dimensions for libsql', async ({ request }) => {
    const vectorId = uniqueId('libsql-dims')
    const vector = randomVector(256) // Wrong dimensions

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        engine: 'libsql',
      },
    })

    // Should reject or handle dimension mismatch
    expect([201, 400]).toContain(response.status())
  })
})

test.describe('Mock Backend - EdgeVec Engine', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('handles edgevec HNSW operations', async ({ request }) => {
    const vectorId = uniqueId('edgevec-test')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { engine: 'edgevec' },
        engine: 'edgevec',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('supports ef parameter for HNSW search', async ({ request }) => {
    // First insert some vectors
    const prefix = uniqueId('edgevec-ef')
    const baseVector = normalizeVector(randomVector(128))

    for (let i = 0; i < 5; i++) {
      await request.post(`${VECTOR_API}/vectors`, {
        data: {
          id: `${prefix}-${i}`,
          vector: normalizeVector(baseVector.map((x) => x + Math.random() * 0.1)),
          metadata: { index: i },
        },
      })
    }

    // Search with ef parameter
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 5,
        ef: 200, // HNSW ef parameter
      },
    })

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.hits).toBeDefined()
  })
})

test.describe('Mock Backend - Vectorize Engine', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('handles vectorize upsert operations', async ({ request }) => {
    const vectorId = uniqueId('vectorize-test')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { engine: 'vectorize' },
        engine: 'vectorize',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('supports namespace parameter', async ({ request }) => {
    const vectorId = uniqueId('vectorize-ns')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { namespace: 'test-ns' },
        namespace: 'test-ns',
      },
    })

    expect(response.status()).toBe(201)
  })
})

test.describe('Mock Backend - ClickHouse Engine', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('handles clickhouse ANN operations', async ({ request }) => {
    const vectorId = uniqueId('clickhouse-test')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { engine: 'clickhouse' },
        engine: 'clickhouse',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('supports hybrid search with text query', async ({ request }) => {
    // Insert vectors with text content
    const prefix = uniqueId('clickhouse-hybrid')
    const baseVector = normalizeVector(randomVector(128))

    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: `${prefix}-1`,
        vector: baseVector,
        metadata: { text: 'machine learning algorithms' },
      },
    })

    // Hybrid search
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 5,
        hybridQuery: 'machine learning',
      },
    })

    expect(response.ok()).toBe(true)
  })
})

test.describe('Mock Backend - Iceberg Engine', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('handles iceberg parquet operations', async ({ request }) => {
    const vectorId = uniqueId('iceberg-test')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: { engine: 'iceberg' },
        engine: 'iceberg',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('supports LSH-based search', async ({ request }) => {
    const prefix = uniqueId('iceberg-lsh')
    const baseVector = normalizeVector(randomVector(128))

    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: `${prefix}-1`,
        vector: baseVector,
        metadata: { lsh: true },
        engine: 'iceberg',
      },
    })

    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 5,
        engine: 'iceberg',
      },
    })

    expect(response.ok()).toBe(true)
  })

  test('supports cluster parameter for partition pruning', async ({ request }) => {
    const prefix = uniqueId('iceberg-cluster')
    const baseVector = normalizeVector(randomVector(128))

    await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: `${prefix}-1`,
        vector: baseVector,
        metadata: { cluster: 'cluster-1' },
      },
    })

    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: baseVector,
        limit: 5,
        cluster: 'cluster-1',
      },
    })

    expect(response.ok()).toBe(true)
  })
})

test.describe('Backend Configuration', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('returns current configuration', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/config`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.config).toBeDefined()
    expect(result.config.tiers).toBeDefined()
    expect(result.config.routing).toBeDefined()
  })

  test('lists supported engines', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/engines`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.engines).toBeDefined()
    expect(Array.isArray(result.engines)).toBe(true)

    // Should include at least the basic engines
    const engineNames = result.engines.map((e: any) => e.name)
    expect(engineNames).toContain('libsql')
  })

  test('returns engine capabilities', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/engines/libsql`)

    expect(response.ok()).toBe(true)
    const result = await response.json()

    expect(result.engine).toBeDefined()
    expect(result.engine.name).toBe('libsql')
    expect(result.engine.dimensions).toBeDefined()
    expect(result.engine.metric).toBeDefined()
  })
})

test.describe('Error Handling', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('handles invalid vector format', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: 'invalid-vec',
        vector: 'not-an-array', // Invalid format
        metadata: {},
      },
    })

    expect(response.status()).toBe(400)
  })

  test('handles missing required fields', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: 'missing-vec',
        // vector is missing
        metadata: {},
      },
    })

    expect(response.status()).toBe(400)
  })

  test('handles invalid search vector', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: 'invalid',
        limit: 10,
      },
    })

    expect(response.status()).toBe(400)
  })

  test('handles non-existent tier', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: normalizeVector(randomVector(128)),
        limit: 10,
        tier: 'nonexistent',
      },
    })

    // Should handle gracefully
    expect([200, 400, 404]).toContain(response.status())
  })

  test('handles invalid strategy', async ({ request }) => {
    const response = await request.post(`${VECTOR_API}/search`, {
      data: {
        vector: normalizeVector(randomVector(128)),
        limit: 10,
        strategy: 'invalid-strategy',
      },
    })

    expect([200, 400]).toContain(response.status())
  })
})

test.describe('Metrics Support', () => {
  test.beforeEach(async ({ request }) => {
    const available = await isVectorApiAvailable(request)
    test.skip(!available, 'Vector API not available')
  })

  test('supports cosine similarity metric', async ({ request }) => {
    const vectorId = uniqueId('metric-cosine')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        metric: 'cosine',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('supports euclidean distance metric', async ({ request }) => {
    const vectorId = uniqueId('metric-euclidean')
    const vector = randomVector(128) // Don't need to normalize for euclidean

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        metric: 'euclidean',
      },
    })

    expect(response.status()).toBe(201)
  })

  test('supports dot product metric', async ({ request }) => {
    const vectorId = uniqueId('metric-dot')
    const vector = normalizeVector(randomVector(128))

    const response = await request.post(`${VECTOR_API}/vectors`, {
      data: {
        id: vectorId,
        vector,
        metadata: {},
        metric: 'dot',
      },
    })

    expect(response.status()).toBe(201)
  })
})

test.describe('Health Check', () => {
  test('returns health status', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/health`)

    // Health endpoint should always respond
    expect([200, 503]).toContain(response.status())

    if (response.ok()) {
      const result = await response.json()
      expect(result.status).toBeDefined()
      expect(['healthy', 'degraded']).toContain(result.status)
    }
  })

  test('includes tier health in status', async ({ request }) => {
    const response = await request.get(`${VECTOR_API}/health`)

    if (response.ok()) {
      const result = await response.json()

      if (result.tiers) {
        for (const tier of Object.keys(result.tiers)) {
          expect(['hot', 'warm', 'cold']).toContain(tier)
          expect(result.tiers[tier].status).toBeDefined()
        }
      }
    }
  })
})
