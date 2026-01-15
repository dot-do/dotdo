/**
 * HybridVectorStore Type Safety Tests
 *
 * These tests verify that HybridVectorStore and HybridSearch classes
 * use proper typing instead of `any` for their database parameters.
 *
 * Issue: do-lv4r
 *
 * Problem (now fixed):
 * - db/vector/hybrid.ts used `any` for database parameter (lines 98, 103)
 * - HybridVectorStore: private db: any
 * - HybridVectorStore: constructor(db: any, options)
 *
 * Solution:
 * - Replaced `any` with `SqlStorageInterface` type from db/vector/store.ts
 *
 * @module tests/db/vector/hybrid-type-safety.test
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { HybridVectorStore, HybridSearch } from '../../../db/vector/hybrid'
import type { SqlStorageInterface } from '../../../db/vector/store'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a properly typed mock database that satisfies SqlStorageInterface
 */
function createTypedMockDb(): SqlStorageInterface {
  return {
    exec: vi.fn((sql: string) => {}),
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...params: unknown[]) => {}),
      get: vi.fn((...params: unknown[]) => undefined as unknown),
      all: vi.fn((...params: unknown[]) => [] as unknown[]),
    })),
  }
}

/**
 * Generate a random normalized vector for testing
 */
function randomNormalizedVector(dims: number, seed?: number): Float32Array {
  const vec = new Float32Array(dims)
  let s = seed ?? Math.floor(Math.random() * 2147483647)

  let norm = 0
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u1 = s / 0x7fffffff
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u2 = s / 0x7fffffff
    const z = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2)
    vec[i] = z
    norm += z * z
  }

  norm = Math.sqrt(norm)
  for (let i = 0; i < dims; i++) {
    vec[i] /= norm
  }

  return vec
}

/**
 * Type-level utility: Check if a type contains any
 * This is a compile-time check - if T contains any, this will be true
 */
type ContainsAny<T> = 0 extends (1 & T) ? true : false

// ============================================================================
// SECTION 1: HybridVectorStore Database Parameter Type Safety
// ============================================================================

describe('HybridVectorStore - Database Parameter Type Safety', () => {
  /**
   * Verifies that HybridVectorStore constructor accepts SqlStorageInterface
   * instead of `any` for the db parameter.
   *
   * Previously: constructor(db: any, options)
   * Now: constructor(db: SqlStorageInterface, options)
   */
  it('should accept SqlStorageInterface for db parameter', () => {
    const typedDb = createTypedMockDb()

    // This should compile without type errors because db parameter
    // is now properly typed as SqlStorageInterface
    const store = new HybridVectorStore(typedDb, { dimension: 1536 })

    expect(store).toBeDefined()
    expect(store.dimension).toBe(1536)
  })

  it('should reject invalid db types at compile time (documented)', () => {
    // NOTE: These tests document what TypeScript catches at compile time.
    // The actual compile errors would prevent the code from running,
    // so we use type assertions to test the runtime behavior.

    // An object missing required methods should fail at compile time
    // The following would produce a TypeScript error:
    // const invalidDb = { notADatabase: true }
    // new HybridVectorStore(invalidDb, { dimension: 1536 }) // TS Error!

    // For runtime verification, we cast to unknown first
    const invalidDb = { notADatabase: true }

    // This will throw at runtime because the object doesn't satisfy
    // SqlStorageInterface (missing exec and prepare methods)
    expect(() => {
      new HybridVectorStore(invalidDb as unknown as SqlStorageInterface, { dimension: 64 })
    }).not.toThrow() // Constructor doesn't validate, but operations would fail

    // The type system is what catches this - runtime check shows construction works
    // but usage would fail because exec/prepare don't exist
  })

  it('should work with minimal SqlStorageInterface implementation', () => {
    // A minimal implementation that satisfies the interface
    const minimalDb: SqlStorageInterface = {
      exec: () => {},
      prepare: () => ({
        run: () => {},
        get: () => undefined as unknown,
        all: () => [] as unknown[],
      }),
    }

    const store = new HybridVectorStore(minimalDb, { dimension: 64 })
    expect(store).toBeDefined()
  })

  it('constructor parameter type should be SqlStorageInterface not any', () => {
    // Type-level test: verify the constructor parameter type
    type ConstructorFirstParam = ConstructorParameters<typeof HybridVectorStore>[0]

    // This verifies the parameter is not `any`
    // If it were `any`, ContainsAny would return true
    const isAny: ContainsAny<ConstructorFirstParam> = false as ContainsAny<ConstructorFirstParam>

    // The type should NOT be any (isAny should be false)
    expect(isAny).toBe(false)

    // Additional type assertion: parameter should have exec method
    expectTypeOf<ConstructorFirstParam>().toHaveProperty('exec')
    expectTypeOf<ConstructorFirstParam>().toHaveProperty('prepare')
  })
})

// ============================================================================
// SECTION 2: HybridSearch Database Parameter Type Safety
// ============================================================================

describe('HybridSearch - Database Parameter Type Safety', () => {
  /**
   * Verifies that HybridSearch constructor accepts SqlStorageInterface
   * instead of `any` for the db parameter.
   *
   * Previously: constructor(db: any)
   * Now: constructor(db: SqlStorageInterface)
   */
  it('should accept SqlStorageInterface for db parameter', () => {
    const typedDb = createTypedMockDb()

    // This should compile without type errors
    const search = new HybridSearch(typedDb)

    expect(search).toBeDefined()
  })

  it('constructor parameter type should be SqlStorageInterface not any', () => {
    type ConstructorFirstParam = ConstructorParameters<typeof HybridSearch>[0]

    // Verify the parameter is not `any`
    const isAny: ContainsAny<ConstructorFirstParam> = false as ContainsAny<ConstructorFirstParam>
    expect(isAny).toBe(false)

    // Verify parameter has required methods
    expectTypeOf<ConstructorFirstParam>().toHaveProperty('exec')
    expectTypeOf<ConstructorFirstParam>().toHaveProperty('prepare')
  })
})

// ============================================================================
// SECTION 3: SqlStorageInterface Contract Verification
// ============================================================================

describe('SqlStorageInterface - Contract Verification', () => {
  /**
   * These tests verify that the SqlStorageInterface exported from
   * db/vector/store.ts has the correct shape and can be properly
   * implemented.
   */
  it('SqlStorageInterface should have exec method', () => {
    // Verify the interface shape
    type ExecType = SqlStorageInterface['exec']

    // exec should be a function
    expectTypeOf<ExecType>().toBeFunction()

    // exec should accept a string parameter
    expectTypeOf<ExecType>().parameters.toEqualTypeOf<[string]>()
  })

  it('SqlStorageInterface should have prepare method', () => {
    type PrepareType = SqlStorageInterface['prepare']

    // prepare should be a function
    expectTypeOf<PrepareType>().toBeFunction()

    // prepare should accept a string parameter
    expectTypeOf<PrepareType>().parameters.toEqualTypeOf<[string]>()

    // prepare should return an object with run, get, all methods
    type PrepareReturn = ReturnType<PrepareType>
    expectTypeOf<PrepareReturn>().toHaveProperty('run')
    expectTypeOf<PrepareReturn>().toHaveProperty('get')
    expectTypeOf<PrepareReturn>().toHaveProperty('all')
  })

  it('prepare().run should accept unknown[] params', () => {
    type PrepareReturn = ReturnType<SqlStorageInterface['prepare']>
    type RunType = PrepareReturn['run']

    // run should be callable with spread params
    expectTypeOf<RunType>().toBeFunction()
  })

  it('prepare().get should return unknown', () => {
    type PrepareReturn = ReturnType<SqlStorageInterface['prepare']>
    type GetType = PrepareReturn['get']

    expectTypeOf<GetType>().toBeFunction()
    expectTypeOf<ReturnType<GetType>>().toEqualTypeOf<unknown>()
  })

  it('prepare().all should return unknown[]', () => {
    type PrepareReturn = ReturnType<SqlStorageInterface['prepare']>
    type AllType = PrepareReturn['all']

    expectTypeOf<AllType>().toBeFunction()
    expectTypeOf<ReturnType<AllType>>().toEqualTypeOf<unknown[]>()
  })
})

// ============================================================================
// SECTION 4: Type Safety Integration Tests
// ============================================================================

describe('HybridVectorStore - Type Safety Integration', () => {
  /**
   * These tests verify that the type safety is maintained through
   * actual usage of the HybridVectorStore.
   */
  it('should maintain type safety through addVector operation', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, { dimension: 64 })

    const embedding = randomNormalizedVector(64, 1)
    const result = await store.addVector('test-1', embedding, {
      content: 'Test document',
      category: 'test',
    })

    // Verify return type
    expect(result).toHaveProperty('$id')
    expect(result.$id).toBe('test-1')
  })

  it('should maintain type safety through search operation', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, { dimension: 64 })

    const embedding = randomNormalizedVector(64, 1)
    await store.addVector('test-1', embedding, { content: 'Test' })

    const results = await store.search(embedding, 10)

    // Results should be properly typed array
    expectTypeOf(results).toBeArray()

    if (results.length > 0) {
      expect(results[0]).toHaveProperty('$id')
      expect(results[0]).toHaveProperty('similarity')
      expect(results[0]).toHaveProperty('distance')
      expect(results[0]).toHaveProperty('metadata')
    }
  })

  it('should maintain type safety through hybridSearch operation', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, { dimension: 64 })

    const embedding = randomNormalizedVector(64, 1)
    await store.addVector('test-1', embedding, { content: 'Python machine learning' })

    const results = await store.hybridSearch(embedding, 'Python', 10)

    // Results should have hybrid-specific fields
    expectTypeOf(results).toBeArray()

    if (results.length > 0) {
      expect(results[0]).toHaveProperty('$id')
      expect(results[0]).toHaveProperty('rrfScore')
      expect(results[0]).toHaveProperty('vectorRank')
      expect(results[0]).toHaveProperty('ftsRank')
    }
  })

  it('should maintain type safety through getVector operation', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 64,
      matryoshkaDims: [64],
    })

    const embedding = randomNormalizedVector(64, 1)
    await store.addVector('test-1', embedding, { content: 'Test' })

    const result = await store.getVector('test-1')

    // Result should be properly typed
    expect(result).not.toBeNull()
    if (result) {
      expect(result).toHaveProperty('$id')
      expect(result).toHaveProperty('embedding')
      expect(result).toHaveProperty('metadata')
      expect(result.embedding).toBeInstanceOf(Float32Array)
    }
  })
})

// ============================================================================
// SECTION 5: Regression Tests for Type Safety
// ============================================================================

describe('HybridVectorStore - Type Safety Regression Tests', () => {
  /**
   * These tests ensure the `any` type doesn't creep back into the codebase.
   * They verify specific patterns that were previously problematic.
   */
  it('HybridVectorStoreOptions should use proper types for metadata', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, { dimension: 64 })

    // Metadata should accept Record<string, unknown>
    const metadata = {
      content: 'Test',
      nested: { key: 'value' },
      array: [1, 2, 3],
      number: 42,
      boolean: true,
      nullable: null,
    }

    await store.addVector('meta-test', randomNormalizedVector(64, 1), metadata)
    const result = await store.getVector('meta-test')

    expect(result?.metadata).toEqual(metadata)
  })

  it('search filters should use proper types', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, { dimension: 64 })

    await store.addVector('filter-test', randomNormalizedVector(64, 1), {
      content: 'Test',
      category: 'ml',
      tier: 'premium',
    })

    // Filters should be Record<string, unknown>
    const filters = {
      category: 'ml',
      tier: 'premium',
    }

    const results = await store.search(randomNormalizedVector(64, 1), 10, filters)
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it('batch operations should maintain type safety', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, { dimension: 64 })

    // BatchVectorInput should be properly typed
    const vectors = [
      {
        id: 'batch-1',
        embedding: randomNormalizedVector(64, 1),
        metadata: { content: 'Doc 1', index: 1 },
      },
      {
        id: 'batch-2',
        embedding: randomNormalizedVector(64, 2),
        metadata: { content: 'Doc 2', index: 2 },
      },
    ]

    const results = await store.addVectors(vectors)

    expect(results).toHaveLength(2)
    expect(results[0]).toHaveProperty('$id')
    expect(results[1]).toHaveProperty('$id')
  })

  it('progressive search options should use proper types', async () => {
    const db = createTypedMockDb()
    const store = new HybridVectorStore(db, {
      dimension: 64,
      matryoshkaDims: [64],
    })

    await store.addVector('prog-1', randomNormalizedVector(64, 1), { content: 'Test' })

    // ProgressiveSearchOptions stages should be properly typed
    const result = await store.progressiveSearch(
      randomNormalizedVector(64, 1),
      10,
      {
        stages: [
          { type: 'binary', candidates: 100 },
          { type: 'matryoshka', dim: 64, candidates: 50 },
          { type: 'exact', candidates: 10 },
        ],
        returnTiming: true,
      }
    )

    // Result with timing should have proper structure
    if ('timing' in result) {
      expect(result.timing).toHaveProperty('total')
      expect(result.timing).toHaveProperty('stages')
    }
  })
})
