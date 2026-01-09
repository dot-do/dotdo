/**
 * EdgePostgres pgvector Integration Tests
 *
 * RED TDD Phase: These tests define the expected behavior for pgvector
 * integration in EdgePostgres. All tests are expected to FAIL initially
 * since the implementation doesn't fully support these features yet.
 *
 * pgvector enables semantic search capabilities:
 * - Vector columns with configurable dimensions (384, 768, 1536)
 * - Distance operators: L2 (<->), cosine (<=>), inner product (<#>)
 * - Index types: HNSW (fast), IVFFlat (memory-efficient)
 * - Approximate (ANN) and exact nearest neighbor search
 *
 * @see https://github.com/pgvector/pgvector for pgvector documentation
 * @see dotdo-f3qki for issue details
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EdgePostgres, type EdgePostgresConfig } from './edge-postgres'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Mock Durable Object context for testing
 */
interface MockDurableObjectState {
  storage: {
    get: <T>(key: string) => Promise<T | undefined>
    put: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
  id: {
    toString: () => string
    name?: string
  }
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  FSX?: unknown
  R2_BUCKET?: unknown
}

/**
 * Create mock DO context for testing
 */
function createMockContext(): MockDurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => { storage.set(key, value) },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    id: {
      toString: () => 'test-do-pgvector-12345',
      name: 'test-do-pgvector',
    },
    waitUntil: (promise: Promise<unknown>) => { promise.catch(() => {}) },
  }
}

/**
 * Create mock environment
 */
function createMockEnv(): MockEnv {
  return {
    FSX: {},
    R2_BUCKET: {},
  }
}

/**
 * Generate a random vector of specified dimensions
 */
function randomVector(dimensions: number): number[] {
  return Array.from({ length: dimensions }, () => Math.random())
}

/**
 * Generate a normalized random vector (unit length)
 */
function normalizedRandomVector(dimensions: number): number[] {
  const vec = randomVector(dimensions)
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  return vec.map(v => v / magnitude)
}

/**
 * Calculate L2 (Euclidean) distance between two vectors
 */
function l2Distance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Calculate cosine distance between two vectors (1 - cosine similarity)
 */
function cosineDistance(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  return 1 - similarity
}

/**
 * Calculate inner product (negative for pgvector ordering)
 */
function innerProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('EdgePostgres pgvector Integration', () => {
  let ctx: MockDurableObjectState
  let env: MockEnv
  let db: EdgePostgres

  beforeEach(() => {
    ctx = createMockContext()
    env = createMockEnv()
  })

  afterEach(async () => {
    if (db) {
      await db.close()
    }
  })

  // ==========================================================================
  // 1. CREATE TABLE WITH VECTOR COLUMN
  // ==========================================================================

  describe('1. Create table with vector column', () => {
    it('should create table with vector(1536) column for OpenAI embeddings', async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })

      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS embeddings_1536 (
          id TEXT PRIMARY KEY,
          content TEXT,
          embedding vector(1536)
        );
      `)

      // Verify table was created with correct column
      const result = await db.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'embeddings_1536' AND column_name = 'embedding'
      `)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].udt_name).toBe('vector')
    })

    it('should create table with vector(384) column for MiniLM embeddings', async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })

      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS embeddings_384 (
          id TEXT PRIMARY KEY,
          embedding vector(384)
        );
      `)

      const result = await db.query('SELECT * FROM embeddings_384')
      expect(result.rows).toEqual([])
    })

    it('should create table with vector(768) column for BERT embeddings', async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })

      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS embeddings_768 (
          id TEXT PRIMARY KEY,
          embedding vector(768)
        );
      `)

      const result = await db.query('SELECT * FROM embeddings_768')
      expect(result.rows).toEqual([])
    })

    it('should create table with multiple vector columns of different dimensions', async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })

      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS multi_embedding (
          id TEXT PRIMARY KEY,
          title_embedding vector(384),
          content_embedding vector(1536),
          summary_embedding vector(768)
        );
      `)

      const result = await db.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'multi_embedding' AND udt_name = 'vector'
      `)

      expect(result.rows).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 2. INSERT VECTORS (EMBEDDINGS)
  // ==========================================================================

  describe('2. Insert vectors (embeddings)', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT,
          embedding vector(1536)
        );
      `)
    })

    it('should insert a single vector embedding', async () => {
      const embedding = randomVector(1536)

      await db.query(
        'INSERT INTO documents (id, content, embedding) VALUES ($1, $2, $3)',
        ['doc-1', 'Hello world', embedding]
      )

      const result = await db.query('SELECT id, content FROM documents WHERE id = $1', ['doc-1'])
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].content).toBe('Hello world')
    })

    it('should insert multiple vectors in batch', async () => {
      const docs = [
        { id: 'doc-1', content: 'First document', embedding: randomVector(1536) },
        { id: 'doc-2', content: 'Second document', embedding: randomVector(1536) },
        { id: 'doc-3', content: 'Third document', embedding: randomVector(1536) },
      ]

      for (const doc of docs) {
        await db.query(
          'INSERT INTO documents (id, content, embedding) VALUES ($1, $2, $3)',
          [doc.id, doc.content, doc.embedding]
        )
      }

      const result = await db.query('SELECT COUNT(*) as count FROM documents')
      expect(result.rows[0].count).toBe(3)
    })

    it('should insert vector with RETURNING clause', async () => {
      const embedding = randomVector(1536)

      const result = await db.query(
        'INSERT INTO documents (id, content, embedding) VALUES ($1, $2, $3) RETURNING id, content',
        ['doc-return', 'Return test', embedding]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe('doc-return')
      expect(result.rows[0].content).toBe('Return test')
    })

    it('should insert null vector when embedding is not provided', async () => {
      await db.query(
        'INSERT INTO documents (id, content) VALUES ($1, $2)',
        ['doc-null', 'No embedding']
      )

      const result = await db.query('SELECT embedding FROM documents WHERE id = $1', ['doc-null'])
      expect(result.rows[0].embedding).toBeNull()
    })

    it('should insert vector using string format [1,2,3]', async () => {
      await db.query(
        "INSERT INTO documents (id, content, embedding) VALUES ($1, $2, $3::vector)",
        ['doc-string', 'String format', '[' + randomVector(1536).join(',') + ']']
      )

      const result = await db.query('SELECT id FROM documents WHERE id = $1', ['doc-string'])
      expect(result.rows).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 3. L2 DISTANCE OPERATOR (<->)
  // ==========================================================================

  describe('3. L2 distance operator (<->)', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS vectors_l2 (
          id TEXT PRIMARY KEY,
          embedding vector(3)
        );
      `)

      // Insert test vectors
      await db.query('INSERT INTO vectors_l2 VALUES ($1, $2)', ['v1', [1, 0, 0]])
      await db.query('INSERT INTO vectors_l2 VALUES ($1, $2)', ['v2', [0, 1, 0]])
      await db.query('INSERT INTO vectors_l2 VALUES ($1, $2)', ['v3', [0, 0, 1]])
      await db.query('INSERT INTO vectors_l2 VALUES ($1, $2)', ['v4', [0.5, 0.5, 0]])
    })

    it('should calculate L2 distance between query and stored vectors', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, embedding <-> $1 AS distance
        FROM vectors_l2
        ORDER BY distance
      `, [queryVector])

      expect(result.rows).toHaveLength(4)
      expect(result.rows[0].id).toBe('v1') // Distance 0
      expect(Number(result.rows[0].distance)).toBeCloseTo(0, 5)
    })

    it('should return vectors ordered by L2 distance (nearest first)', async () => {
      const queryVector = [0.6, 0.6, 0]
      const result = await db.query(`
        SELECT id, embedding <-> $1 AS distance
        FROM vectors_l2
        ORDER BY distance
        LIMIT 3
      `, [queryVector])

      // v4 [0.5, 0.5, 0] is closest to [0.6, 0.6, 0]
      expect(result.rows[0].id).toBe('v4')
    })

    it('should calculate correct L2 distance values', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, embedding <-> $1 AS distance
        FROM vectors_l2
        WHERE id = 'v2'
      `, [queryVector])

      // L2 distance between [1,0,0] and [0,1,0] should be sqrt(2)
      expect(Number(result.rows[0].distance)).toBeCloseTo(Math.sqrt(2), 5)
    })

    it('should support L2 distance in WHERE clause for threshold filtering', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id FROM vectors_l2
        WHERE embedding <-> $1 < 1.5
        ORDER BY embedding <-> $1
      `, [queryVector])

      // v1 (distance 0), v4 (distance ~0.71) should be included
      // v2, v3 (distance sqrt(2) ~1.41) should be included
      expect(result.rows.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 4. COSINE DISTANCE OPERATOR (<=>)
  // ==========================================================================

  describe('4. Cosine distance operator (<=>)', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS vectors_cosine (
          id TEXT PRIMARY KEY,
          embedding vector(3)
        );
      `)

      // Insert normalized vectors for easier cosine distance testing
      await db.query('INSERT INTO vectors_cosine VALUES ($1, $2)', ['same', [1, 0, 0]])
      await db.query('INSERT INTO vectors_cosine VALUES ($1, $2)', ['similar', [0.9, 0.1, 0]])
      await db.query('INSERT INTO vectors_cosine VALUES ($1, $2)', ['orthogonal', [0, 1, 0]])
      await db.query('INSERT INTO vectors_cosine VALUES ($1, $2)', ['opposite', [-1, 0, 0]])
    })

    it('should calculate cosine distance between vectors', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, embedding <=> $1 AS distance
        FROM vectors_cosine
        ORDER BY distance
      `, [queryVector])

      expect(result.rows).toHaveLength(4)
      expect(result.rows[0].id).toBe('same') // Distance 0 (identical direction)
    })

    it('should return 0 distance for identical direction vectors', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, embedding <=> $1 AS distance
        FROM vectors_cosine
        WHERE id = 'same'
      `, [queryVector])

      expect(Number(result.rows[0].distance)).toBeCloseTo(0, 5)
    })

    it('should return ~1 distance for orthogonal vectors', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, embedding <=> $1 AS distance
        FROM vectors_cosine
        WHERE id = 'orthogonal'
      `, [queryVector])

      // Cosine distance for orthogonal vectors is 1
      expect(Number(result.rows[0].distance)).toBeCloseTo(1, 5)
    })

    it('should return ~2 distance for opposite vectors', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, embedding <=> $1 AS distance
        FROM vectors_cosine
        WHERE id = 'opposite'
      `, [queryVector])

      // Cosine distance for opposite vectors is 2
      expect(Number(result.rows[0].distance)).toBeCloseTo(2, 5)
    })

    it('should convert cosine distance to similarity', async () => {
      const queryVector = [1, 0, 0]
      const result = await db.query(`
        SELECT id, 1 - (embedding <=> $1) AS similarity
        FROM vectors_cosine
        ORDER BY similarity DESC
      `, [queryVector])

      expect(result.rows[0].id).toBe('same')
      expect(Number(result.rows[0].similarity)).toBeCloseTo(1, 5)
    })
  })

  // ==========================================================================
  // 5. INNER PRODUCT OPERATOR (<#>)
  // ==========================================================================

  describe('5. Inner product operator (<#>)', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS vectors_ip (
          id TEXT PRIMARY KEY,
          embedding vector(3)
        );
      `)

      await db.query('INSERT INTO vectors_ip VALUES ($1, $2)', ['v1', [1, 2, 3]])
      await db.query('INSERT INTO vectors_ip VALUES ($1, $2)', ['v2', [4, 5, 6]])
      await db.query('INSERT INTO vectors_ip VALUES ($1, $2)', ['v3', [-1, -2, -3]])
    })

    it('should calculate negative inner product for ordering', async () => {
      const queryVector = [1, 1, 1]
      const result = await db.query(`
        SELECT id, embedding <#> $1 AS neg_inner_product
        FROM vectors_ip
        ORDER BY neg_inner_product
      `, [queryVector])

      // <#> returns negative inner product for ORDER BY ASC to get highest IP first
      // Inner products: v1=6, v2=15, v3=-6
      // Negative inner products: v1=-6, v2=-15, v3=6
      // ORDER BY ASC: v2 (-15), v1 (-6), v3 (6)
      expect(result.rows[0].id).toBe('v2') // Highest inner product
    })

    it('should convert to actual inner product with negation', async () => {
      const queryVector = [1, 1, 1]
      const result = await db.query(`
        SELECT id, (embedding <#> $1) * -1 AS inner_product
        FROM vectors_ip
        ORDER BY embedding <#> $1
      `, [queryVector])

      // v1: 1*1 + 2*1 + 3*1 = 6
      // v2: 4*1 + 5*1 + 6*1 = 15
      expect(Number(result.rows[0].inner_product)).toBe(15)
      expect(Number(result.rows[1].inner_product)).toBe(6)
    })

    it('should work with normalized vectors for maximum inner product search', async () => {
      // For normalized vectors, max inner product = max cosine similarity
      const normalized1 = normalizedRandomVector(3)
      const normalized2 = normalizedRandomVector(3)

      await db.query('INSERT INTO vectors_ip VALUES ($1, $2)', ['norm1', normalized1])
      await db.query('INSERT INTO vectors_ip VALUES ($1, $2)', ['norm2', normalized2])

      const result = await db.query(`
        SELECT id, (embedding <#> $1) * -1 AS inner_product
        FROM vectors_ip
        WHERE id IN ('norm1', 'norm2')
        ORDER BY embedding <#> $1
      `, [normalized1])

      // norm1 should have highest inner product with itself
      expect(result.rows[0].id).toBe('norm1')
    })
  })

  // ==========================================================================
  // 6. HNSW INDEX CREATION
  // ==========================================================================

  describe('6. HNSW index creation', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS hnsw_test (
          id TEXT PRIMARY KEY,
          embedding vector(128)
        );
      `)
    })

    it('should create HNSW index with cosine distance', async () => {
      await db.exec(`
        CREATE INDEX hnsw_cosine_idx ON hnsw_test
        USING hnsw (embedding vector_cosine_ops)
      `)

      const result = await db.query(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'hnsw_test' AND indexname = 'hnsw_cosine_idx'
      `)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].indexdef).toContain('hnsw')
      expect(result.rows[0].indexdef).toContain('vector_cosine_ops')
    })

    it('should create HNSW index with L2 distance', async () => {
      await db.exec(`
        CREATE INDEX hnsw_l2_idx ON hnsw_test
        USING hnsw (embedding vector_l2_ops)
      `)

      const result = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'hnsw_test' AND indexname = 'hnsw_l2_idx'
      `)

      expect(result.rows).toHaveLength(1)
    })

    it('should create HNSW index with inner product', async () => {
      await db.exec(`
        CREATE INDEX hnsw_ip_idx ON hnsw_test
        USING hnsw (embedding vector_ip_ops)
      `)

      const result = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'hnsw_test' AND indexname = 'hnsw_ip_idx'
      `)

      expect(result.rows).toHaveLength(1)
    })

    it('should create HNSW index with custom parameters', async () => {
      await db.exec(`
        CREATE INDEX hnsw_custom_idx ON hnsw_test
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `)

      const result = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'hnsw_test' AND indexname = 'hnsw_custom_idx'
      `)

      expect(result.rows).toHaveLength(1)
    })

    it('should use HNSW index for queries after creation', async () => {
      // Insert data first
      for (let i = 0; i < 50; i++) {
        await db.query(
          'INSERT INTO hnsw_test VALUES ($1, $2)',
          [`doc-${i}`, randomVector(128)]
        )
      }

      // Create index
      await db.exec(`
        CREATE INDEX ON hnsw_test USING hnsw (embedding vector_cosine_ops)
      `)

      // Query should work (and use index)
      const queryVector = randomVector(128)
      const result = await db.query(`
        SELECT id FROM hnsw_test
        ORDER BY embedding <=> $1
        LIMIT 5
      `, [queryVector])

      expect(result.rows).toHaveLength(5)
    })
  })

  // ==========================================================================
  // 7. IVFFLAT INDEX CREATION
  // ==========================================================================

  describe('7. IVFFlat index creation', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS ivfflat_test (
          id TEXT PRIMARY KEY,
          embedding vector(128)
        );
      `)

      // IVFFlat requires data to be present before index creation
      for (let i = 0; i < 100; i++) {
        await db.query(
          'INSERT INTO ivfflat_test VALUES ($1, $2)',
          [`doc-${i}`, randomVector(128)]
        )
      }
    })

    it('should create IVFFlat index with cosine distance', async () => {
      await db.exec(`
        CREATE INDEX ivfflat_cosine_idx ON ivfflat_test
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 10)
      `)

      const result = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'ivfflat_test' AND indexname = 'ivfflat_cosine_idx'
      `)

      expect(result.rows).toHaveLength(1)
    })

    it('should create IVFFlat index with L2 distance', async () => {
      await db.exec(`
        CREATE INDEX ivfflat_l2_idx ON ivfflat_test
        USING ivfflat (embedding vector_l2_ops)
        WITH (lists = 10)
      `)

      const result = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'ivfflat_test' AND indexname = 'ivfflat_l2_idx'
      `)

      expect(result.rows).toHaveLength(1)
    })

    it('should create IVFFlat index with custom list count', async () => {
      // Lists should be sqrt(rows) for optimal performance
      await db.exec(`
        CREATE INDEX ivfflat_custom_idx ON ivfflat_test
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 20)
      `)

      const result = await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'ivfflat_test' AND indexname = 'ivfflat_custom_idx'
      `)

      expect(result.rows).toHaveLength(1)
    })

    it('should use IVFFlat index for queries', async () => {
      await db.exec(`
        CREATE INDEX ON ivfflat_test
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 10)
      `)

      const queryVector = randomVector(128)
      const result = await db.query(`
        SELECT id FROM ivfflat_test
        ORDER BY embedding <=> $1
        LIMIT 5
      `, [queryVector])

      expect(result.rows).toHaveLength(5)
    })

    it('should set probes for IVFFlat query accuracy', async () => {
      await db.exec(`
        CREATE INDEX ON ivfflat_test
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 10)
      `)

      // Set higher probes for better recall
      await db.exec('SET ivfflat.probes = 5')

      const queryVector = randomVector(128)
      const result = await db.query(`
        SELECT id FROM ivfflat_test
        ORDER BY embedding <=> $1
        LIMIT 10
      `, [queryVector])

      expect(result.rows).toHaveLength(10)
    })
  })

  // ==========================================================================
  // 8. APPROXIMATE NEAREST NEIGHBOR (ANN) SEARCH
  // ==========================================================================

  describe('8. Approximate nearest neighbor (ANN) search', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS ann_test (
          id TEXT PRIMARY KEY,
          content TEXT,
          embedding vector(128)
        );
      `)

      // Insert test data
      for (let i = 0; i < 100; i++) {
        await db.query(
          'INSERT INTO ann_test VALUES ($1, $2, $3)',
          [`doc-${i}`, `Content ${i}`, randomVector(128)]
        )
      }

      // Create HNSW index for ANN search
      await db.exec(`
        CREATE INDEX ON ann_test USING hnsw (embedding vector_cosine_ops)
      `)
    })

    it('should perform ANN search with ORDER BY + LIMIT', async () => {
      const queryVector = randomVector(128)

      const result = await db.query(`
        SELECT id, content, embedding <=> $1 AS distance
        FROM ann_test
        ORDER BY distance
        LIMIT 10
      `, [queryVector])

      expect(result.rows).toHaveLength(10)
      // Results should be ordered by distance
      for (let i = 1; i < result.rows.length; i++) {
        expect(Number(result.rows[i].distance)).toBeGreaterThanOrEqual(
          Number(result.rows[i - 1].distance)
        )
      }
    })

    it('should return top-k nearest neighbors efficiently', async () => {
      const queryVector = randomVector(128)

      const startTime = Date.now()
      const result = await db.query(`
        SELECT id FROM ann_test
        ORDER BY embedding <=> $1
        LIMIT 5
      `, [queryVector])
      const elapsed = Date.now() - startTime

      expect(result.rows).toHaveLength(5)
      // ANN should be fast (< 1 second for 100 vectors)
      expect(elapsed).toBeLessThan(1000)
    })

    it('should support ANN search with ef_search parameter for HNSW', async () => {
      // Higher ef_search = better recall, slower search
      await db.exec('SET hnsw.ef_search = 100')

      const queryVector = randomVector(128)
      const result = await db.query(`
        SELECT id FROM ann_test
        ORDER BY embedding <=> $1
        LIMIT 10
      `, [queryVector])

      expect(result.rows).toHaveLength(10)
    })

    it('should combine ANN search with WHERE clause filtering', async () => {
      const queryVector = randomVector(128)

      const result = await db.query(`
        SELECT id, content FROM ann_test
        WHERE content LIKE 'Content 1%'
        ORDER BY embedding <=> $1
        LIMIT 5
      `, [queryVector])

      // All results should match the WHERE clause
      for (const row of result.rows) {
        expect(row.content).toMatch(/^Content 1/)
      }
    })
  })

  // ==========================================================================
  // 9. EXACT NEAREST NEIGHBOR SEARCH
  // ==========================================================================

  describe('9. Exact nearest neighbor search', () => {
    const testVectors: { id: string; embedding: number[] }[] = []

    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS exact_test (
          id TEXT PRIMARY KEY,
          embedding vector(8)
        );
      `)

      // Insert known vectors for exact distance verification
      testVectors.length = 0
      for (let i = 0; i < 20; i++) {
        const vec = randomVector(8)
        testVectors.push({ id: `doc-${i}`, embedding: vec })
        await db.query(
          'INSERT INTO exact_test VALUES ($1, $2)',
          [`doc-${i}`, vec]
        )
      }
    })

    it('should perform exact search without index (sequential scan)', async () => {
      // No index - will use sequential scan for exact results
      const queryVector = randomVector(8)

      const result = await db.query(`
        SELECT id, embedding <-> $1 AS distance
        FROM exact_test
        ORDER BY distance
        LIMIT 5
      `, [queryVector])

      expect(result.rows).toHaveLength(5)

      // Verify distances are actually correct by computing manually
      const expectedDistances = testVectors
        .map(v => ({ id: v.id, distance: l2Distance(v.embedding, queryVector) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)

      for (let i = 0; i < 5; i++) {
        expect(result.rows[i].id).toBe(expectedDistances[i].id)
        expect(Number(result.rows[i].distance)).toBeCloseTo(expectedDistances[i].distance, 4)
      }
    })

    it('should match exact search results with manual distance calculation', async () => {
      const queryVector = testVectors[0].embedding // Use first vector as query

      const result = await db.query(`
        SELECT id, embedding <-> $1 AS l2_dist, embedding <=> $1 AS cos_dist
        FROM exact_test
        ORDER BY l2_dist
        LIMIT 3
      `, [queryVector])

      // First result should be the query vector itself
      expect(result.rows[0].id).toBe(testVectors[0].id)
      expect(Number(result.rows[0].l2_dist)).toBeCloseTo(0, 5)
      expect(Number(result.rows[0].cos_dist)).toBeCloseTo(0, 5)
    })

    it('should support exact search with all distance metrics', async () => {
      const queryVector = randomVector(8)

      // L2 distance
      const l2Result = await db.query(`
        SELECT id, embedding <-> $1 AS distance FROM exact_test
        ORDER BY distance LIMIT 3
      `, [queryVector])

      // Cosine distance
      const cosineResult = await db.query(`
        SELECT id, embedding <=> $1 AS distance FROM exact_test
        ORDER BY distance LIMIT 3
      `, [queryVector])

      // Inner product
      const ipResult = await db.query(`
        SELECT id, embedding <#> $1 AS neg_ip FROM exact_test
        ORDER BY neg_ip LIMIT 3
      `, [queryVector])

      expect(l2Result.rows).toHaveLength(3)
      expect(cosineResult.rows).toHaveLength(3)
      expect(ipResult.rows).toHaveLength(3)

      // Different metrics may give different orderings
    })
  })

  // ==========================================================================
  // 10. VECTOR WITH DIFFERENT DIMENSIONS
  // ==========================================================================

  describe('10. Vector with different dimensions', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')
    })

    it('should support 384-dimensional vectors (MiniLM)', async () => {
      await db.exec(`
        CREATE TABLE vectors_384 (id TEXT PRIMARY KEY, embedding vector(384));
      `)

      const embedding = randomVector(384)
      await db.query('INSERT INTO vectors_384 VALUES ($1, $2)', ['v1', embedding])

      const result = await db.query('SELECT id FROM vectors_384')
      expect(result.rows).toHaveLength(1)
    })

    it('should support 768-dimensional vectors (BERT)', async () => {
      await db.exec(`
        CREATE TABLE vectors_768 (id TEXT PRIMARY KEY, embedding vector(768));
      `)

      const embedding = randomVector(768)
      await db.query('INSERT INTO vectors_768 VALUES ($1, $2)', ['v1', embedding])

      const result = await db.query('SELECT id FROM vectors_768')
      expect(result.rows).toHaveLength(1)
    })

    it('should support 1536-dimensional vectors (OpenAI)', async () => {
      await db.exec(`
        CREATE TABLE vectors_1536 (id TEXT PRIMARY KEY, embedding vector(1536));
      `)

      const embedding = randomVector(1536)
      await db.query('INSERT INTO vectors_1536 VALUES ($1, $2)', ['v1', embedding])

      const result = await db.query('SELECT id FROM vectors_1536')
      expect(result.rows).toHaveLength(1)
    })

    it('should support 3072-dimensional vectors (OpenAI text-embedding-3-large)', async () => {
      await db.exec(`
        CREATE TABLE vectors_3072 (id TEXT PRIMARY KEY, embedding vector(3072));
      `)

      const embedding = randomVector(3072)
      await db.query('INSERT INTO vectors_3072 VALUES ($1, $2)', ['v1', embedding])

      const result = await db.query('SELECT id FROM vectors_3072')
      expect(result.rows).toHaveLength(1)
    })

    it('should perform search on high-dimensional vectors', async () => {
      await db.exec(`
        CREATE TABLE vectors_large (id TEXT PRIMARY KEY, embedding vector(1536));
      `)

      // Insert multiple vectors
      for (let i = 0; i < 10; i++) {
        await db.query('INSERT INTO vectors_large VALUES ($1, $2)', [`v${i}`, randomVector(1536)])
      }

      const queryVector = randomVector(1536)
      const result = await db.query(`
        SELECT id, embedding <=> $1 AS distance
        FROM vectors_large
        ORDER BY distance
        LIMIT 3
      `, [queryVector])

      expect(result.rows).toHaveLength(3)
    })

    it('should handle small dimensions for testing (3D)', async () => {
      await db.exec(`
        CREATE TABLE vectors_small (id TEXT PRIMARY KEY, embedding vector(3));
      `)

      await db.query('INSERT INTO vectors_small VALUES ($1, $2)', ['origin', [0, 0, 0]])
      await db.query('INSERT INTO vectors_small VALUES ($1, $2)', ['unit_x', [1, 0, 0]])
      await db.query('INSERT INTO vectors_small VALUES ($1, $2)', ['unit_y', [0, 1, 0]])
      await db.query('INSERT INTO vectors_small VALUES ($1, $2)', ['unit_z', [0, 0, 1]])

      const result = await db.query(`
        SELECT id, embedding <-> '[0,0,0]'::vector AS distance
        FROM vectors_small
        ORDER BY distance
      `)

      expect(result.rows[0].id).toBe('origin')
      expect(Number(result.rows[0].distance)).toBe(0)
    })
  })

  // ==========================================================================
  // 11. ERROR HANDLING FOR MISMATCHED DIMENSIONS
  // ==========================================================================

  describe('11. Error handling for mismatched dimensions', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE dimension_test (
          id TEXT PRIMARY KEY,
          embedding vector(128)
        );
      `)
    })

    it('should throw error when inserting vector with wrong dimensions', async () => {
      const wrongDimensions = randomVector(64) // Table expects 128

      await expect(
        db.query('INSERT INTO dimension_test VALUES ($1, $2)', ['bad', wrongDimensions])
      ).rejects.toThrow(/dimension|expected 128/i)
    })

    it('should throw error when inserting vector with too many dimensions', async () => {
      const tooManyDimensions = randomVector(256) // Table expects 128

      await expect(
        db.query('INSERT INTO dimension_test VALUES ($1, $2)', ['bad', tooManyDimensions])
      ).rejects.toThrow(/dimension|expected 128/i)
    })

    it('should throw error when querying with wrong dimensions', async () => {
      // Insert valid vector first
      await db.query('INSERT INTO dimension_test VALUES ($1, $2)', ['good', randomVector(128)])

      const wrongQueryVector = randomVector(64) // Mismatch

      await expect(
        db.query(`
          SELECT id FROM dimension_test
          ORDER BY embedding <-> $1
        `, [wrongQueryVector])
      ).rejects.toThrow(/dimension|different|mismatch/i)
    })

    it('should throw error when comparing vectors of different dimensions', async () => {
      await db.exec(`
        CREATE TABLE dim_a (id TEXT, embedding vector(64));
        CREATE TABLE dim_b (id TEXT, embedding vector(128));
        INSERT INTO dim_a VALUES ('a', ${JSON.stringify(randomVector(64))});
        INSERT INTO dim_b VALUES ('b', ${JSON.stringify(randomVector(128))});
      `)

      await expect(
        db.query(`
          SELECT a.id, b.id, a.embedding <-> b.embedding AS distance
          FROM dim_a a, dim_b b
        `)
      ).rejects.toThrow(/dimension|different|cannot/i)
    })

    it('should provide helpful error message for dimension mismatch', async () => {
      const wrongDimensions = randomVector(100)

      try {
        await db.query('INSERT INTO dimension_test VALUES ($1, $2)', ['bad', wrongDimensions])
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).toBeTruthy()
        // Error should mention dimensions
        expect((error as Error).message.toLowerCase()).toMatch(/dimension|vector|128|100/)
      }
    })

    it('should reject empty vector', async () => {
      await expect(
        db.query('INSERT INTO dimension_test VALUES ($1, $2)', ['empty', []])
      ).rejects.toThrow()
    })

    it('should reject non-numeric vector elements', async () => {
      await expect(
        db.query("INSERT INTO dimension_test VALUES ($1, '[1,2,three]'::vector)", ['invalid'])
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 12. INTEGRATION WITH EXISTING EDGEPOSTGRES QUERY API
  // ==========================================================================

  describe('12. Integration with existing EdgePostgres query API', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          title TEXT,
          content TEXT,
          embedding vector(128),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `)
    })

    it('should work with existing query() method', async () => {
      const embedding = randomVector(128)

      await db.query(
        'INSERT INTO documents (id, title, content, embedding) VALUES ($1, $2, $3, $4)',
        ['doc-1', 'Test Title', 'Test content', embedding]
      )

      const result = await db.query('SELECT * FROM documents WHERE id = $1', ['doc-1'])
      expect(result.rows[0].title).toBe('Test Title')
    })

    it('should work with existing exec() method', async () => {
      await db.exec(`
        INSERT INTO documents (id, title, embedding)
        VALUES ('exec-doc', 'Exec Test', '[${randomVector(128).join(',')}]');
      `)

      const result = await db.query('SELECT id FROM documents WHERE id = $1', ['exec-doc'])
      expect(result.rows).toHaveLength(1)
    })

    it('should work with transactions', async () => {
      const embedding1 = randomVector(128)
      const embedding2 = randomVector(128)

      await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
          ['tx-doc-1', 'Transaction Doc 1', embedding1]
        )
        await tx.query(
          'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
          ['tx-doc-2', 'Transaction Doc 2', embedding2]
        )
      })

      const result = await db.query('SELECT COUNT(*) as count FROM documents')
      expect(result.rows[0].count).toBe(2)
    })

    it('should rollback transaction with vector operations on error', async () => {
      const embedding = randomVector(128)

      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
            ['rollback-doc', 'Will be rolled back', embedding]
          )
          throw new Error('Rollback test')
        })
      ).rejects.toThrow('Rollback test')

      const result = await db.query('SELECT COUNT(*) as count FROM documents')
      expect(result.rows[0].count).toBe(0)
    })

    it('should work with checkpoint and restore', async () => {
      const embedding = randomVector(128)

      await db.query(
        'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
        ['checkpoint-doc', 'Checkpoint Test', embedding]
      )
      await db.checkpoint()
      await db.close()

      // Create new instance
      const db2 = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })

      const result = await db2.query('SELECT id FROM documents WHERE id = $1', ['checkpoint-doc'])
      expect(result.rows).toHaveLength(1)

      await db2.close()
      db = null as unknown as EdgePostgres // Prevent afterEach from closing again
    })

    it('should combine vector search with JSONB queries', async () => {
      const embedding = randomVector(128)

      await db.query(
        `INSERT INTO documents (id, title, embedding, metadata)
         VALUES ($1, $2, $3, $4)`,
        ['json-doc', 'JSON Test', embedding, JSON.stringify({ category: 'test', tags: ['a', 'b'] })]
      )

      const queryVector = randomVector(128)
      const result = await db.query(`
        SELECT id, title, embedding <=> $1 AS distance
        FROM documents
        WHERE metadata->>'category' = 'test'
        ORDER BY distance
      `, [queryVector])

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].title).toBe('JSON Test')
    })

    it('should work with query options (tier)', async () => {
      const embedding = randomVector(128)

      await db.query(
        'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
        ['tier-doc', 'Tier Test', embedding],
        { tier: 'hot' }
      )

      const queryVector = randomVector(128)
      const result = await db.query(`
        SELECT id FROM documents
        ORDER BY embedding <=> $1
        LIMIT 1
      `, [queryVector], { tier: 'hot' })

      expect(result.rows).toHaveLength(1)
    })

    it('should support RETURNING with vector operations', async () => {
      const embedding = randomVector(128)

      const result = await db.query(
        'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3) RETURNING id, title',
        ['return-doc', 'Return Test', embedding]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe('return-doc')
      expect(result.rows[0].title).toBe('Return Test')
    })

    it('should support UPDATE with vector columns', async () => {
      const embedding1 = randomVector(128)
      const embedding2 = randomVector(128)

      await db.query(
        'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
        ['update-doc', 'Original', embedding1]
      )

      await db.query(
        'UPDATE documents SET title = $1, embedding = $2 WHERE id = $3',
        ['Updated', embedding2, 'update-doc']
      )

      const result = await db.query('SELECT title FROM documents WHERE id = $1', ['update-doc'])
      expect(result.rows[0].title).toBe('Updated')
    })

    it('should support DELETE with vector search in subquery', async () => {
      // Insert multiple documents
      for (let i = 0; i < 10; i++) {
        await db.query(
          'INSERT INTO documents (id, title, embedding) VALUES ($1, $2, $3)',
          [`del-doc-${i}`, `Document ${i}`, randomVector(128)]
        )
      }

      const queryVector = randomVector(128)

      // Delete the 3 most similar documents
      await db.query(`
        DELETE FROM documents
        WHERE id IN (
          SELECT id FROM documents
          ORDER BY embedding <=> $1
          LIMIT 3
        )
      `, [queryVector])

      const result = await db.query('SELECT COUNT(*) as count FROM documents')
      expect(result.rows[0].count).toBe(7)
    })
  })

  // ==========================================================================
  // ADDITIONAL EDGE CASES
  // ==========================================================================

  describe('Additional edge cases', () => {
    beforeEach(async () => {
      db = new EdgePostgres(ctx, env, {
        pglite: { extensions: ['pgvector'] },
      })
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE edge_cases (
          id TEXT PRIMARY KEY,
          embedding vector(8)
        );
      `)
    })

    it('should handle zero vector', async () => {
      const zeroVector = Array(8).fill(0)

      await db.query('INSERT INTO edge_cases VALUES ($1, $2)', ['zero', zeroVector])

      const result = await db.query('SELECT id FROM edge_cases WHERE id = $1', ['zero'])
      expect(result.rows).toHaveLength(1)
    })

    it('should handle vectors with negative values', async () => {
      const negativeVector = [-1, -2, -3, -4, -5, -6, -7, -8]

      await db.query('INSERT INTO edge_cases VALUES ($1, $2)', ['negative', negativeVector])

      const queryVector = [-1, -2, -3, -4, -5, -6, -7, -8]
      const result = await db.query(`
        SELECT id, embedding <-> $1 AS distance
        FROM edge_cases
        WHERE id = 'negative'
      `, [queryVector])

      expect(Number(result.rows[0].distance)).toBeCloseTo(0, 5)
    })

    it('should handle vectors with very small values', async () => {
      const smallVector = Array(8).fill(1e-10)

      await db.query('INSERT INTO edge_cases VALUES ($1, $2)', ['small', smallVector])

      const result = await db.query('SELECT id FROM edge_cases WHERE id = $1', ['small'])
      expect(result.rows).toHaveLength(1)
    })

    it('should handle vectors with very large values', async () => {
      const largeVector = Array(8).fill(1e10)

      await db.query('INSERT INTO edge_cases VALUES ($1, $2)', ['large', largeVector])

      const result = await db.query('SELECT id FROM edge_cases WHERE id = $1', ['large'])
      expect(result.rows).toHaveLength(1)
    })

    it('should handle unit vectors correctly', async () => {
      // Insert all standard basis vectors
      const basisVectors = [
        [1, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0, 0, 0],
        [0, 0, 0, 1, 0, 0, 0, 0],
        [0, 0, 0, 0, 1, 0, 0, 0],
        [0, 0, 0, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 0, 0, 0, 1],
      ]

      for (let i = 0; i < basisVectors.length; i++) {
        await db.query('INSERT INTO edge_cases VALUES ($1, $2)', [`basis-${i}`, basisVectors[i]])
      }

      // Query with first basis vector
      const result = await db.query(`
        SELECT id, embedding <=> $1 AS distance
        FROM edge_cases
        ORDER BY distance
      `, [basisVectors[0]])

      // First result should be basis-0 (cosine distance 0)
      expect(result.rows[0].id).toBe('basis-0')
      // Others should have cosine distance 1 (orthogonal)
      expect(Number(result.rows[1].distance)).toBeCloseTo(1, 5)
    })

    it('should handle concurrent vector insertions', async () => {
      const insertions = Array.from({ length: 10 }, (_, i) =>
        db.query('INSERT INTO edge_cases VALUES ($1, $2)', [`concurrent-${i}`, randomVector(8)])
      )

      await Promise.all(insertions)

      const result = await db.query('SELECT COUNT(*) as count FROM edge_cases')
      expect(result.rows[0].count).toBe(10)
    })

    it('should handle concurrent vector searches', async () => {
      // Insert test data
      for (let i = 0; i < 20; i++) {
        await db.query('INSERT INTO edge_cases VALUES ($1, $2)', [`search-${i}`, randomVector(8)])
      }

      // Perform concurrent searches
      const searches = Array.from({ length: 5 }, () =>
        db.query(`
          SELECT id FROM edge_cases
          ORDER BY embedding <=> $1
          LIMIT 5
        `, [randomVector(8)])
      )

      const results = await Promise.all(searches)

      // All searches should return 5 results
      for (const result of results) {
        expect(result.rows).toHaveLength(5)
      }
    })
  })
})
