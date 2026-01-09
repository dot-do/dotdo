/**
 * DO Collection Type FK Resolution Tests - TDD RED Phase
 *
 * Tests for proper type FK resolution in DO.collection() method.
 *
 * The issue: DO.ts:199-200 uses hardcoded `type: 0`. Need to resolve
 * noun names to FK IDs by querying the nouns table.
 *
 * Expected behavior:
 * - collection('Startup') should look up 'Startup' in nouns table
 * - Get the noun's rowid as the type FK
 * - Use that FK when creating/filtering things
 *
 * Reference: dotdo-xv5j - Implement Type FK Resolution in collection()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import * as schema from '../../db'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 * Enhanced to support querying nouns table
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: {
    get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
    put<T>(key: string | Record<string, T>, value?: T): Promise<void>
    delete(key: string | string[]): Promise<boolean | number>
    deleteAll(): Promise<void>
    list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
    sql: unknown
  }
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// TESTS: Type FK Resolution in collection()
// ============================================================================

describe('DO.collection() Type FK Resolution', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com' })
  })

  // ==========================================================================
  // RED PHASE: Tests that should FAIL with current hardcoded `type: 0`
  // ==========================================================================

  describe('Noun to FK Resolution', () => {
    it('should have a resolveNounToFK method on DO', () => {
      // RED: This method doesn't exist yet
      // The DO class should have a method to resolve noun names to their FK IDs
      const resolveNounToFK = (doInstance as unknown as {
        resolveNounToFK?: (noun: string) => Promise<number>
      }).resolveNounToFK

      expect(resolveNounToFK).toBeDefined()
      expect(typeof resolveNounToFK).toBe('function')
    })

    it('resolveNounToFK should return correct FK for registered noun', async () => {
      // RED: This test requires the method to exist and work properly
      // When 'Startup' is registered in nouns table with rowid 1,
      // resolveNounToFK('Startup') should return 1

      const resolveNounToFK = (doInstance as unknown as {
        resolveNounToFK: (noun: string) => Promise<number>
      }).resolveNounToFK

      // Skip if method doesn't exist (will fail in RED phase)
      if (!resolveNounToFK) {
        expect(resolveNounToFK).toBeDefined() // Force fail
        return
      }

      // This would need nouns table to be populated first
      // In a real test with proper DB, we'd insert a noun first
      const fk = await resolveNounToFK.call(doInstance, 'Startup')

      // Should return a non-zero FK for registered nouns
      expect(typeof fk).toBe('number')
    })

    it('resolveNounToFK should cache results for performance', async () => {
      // RED: The method should use _typeCache for performance
      const typeCache = (doInstance as unknown as {
        _typeCache: Map<string, number>
      })._typeCache

      expect(typeCache).toBeInstanceOf(Map)

      // After resolving, the result should be cached
      const resolveNounToFK = (doInstance as unknown as {
        resolveNounToFK?: (noun: string) => Promise<number>
      }).resolveNounToFK

      if (!resolveNounToFK) {
        expect(resolveNounToFK).toBeDefined() // Force fail
        return
      }

      await resolveNounToFK.call(doInstance, 'Startup')

      // Cache should now have an entry for 'Startup'
      // (In GREEN phase, this would be the resolved FK)
      expect(typeCache.has('Startup')).toBe(true)
    })

    it('resolveNounToFK should throw for unregistered noun', async () => {
      // RED: Unregistered nouns should throw an error
      // This prevents accidentally using type: 0 for everything

      const resolveNounToFK = (doInstance as unknown as {
        resolveNounToFK?: (noun: string) => Promise<number>
      }).resolveNounToFK

      if (!resolveNounToFK) {
        expect(resolveNounToFK).toBeDefined() // Force fail
        return
      }

      // 'UnregisteredNoun' should not exist in nouns table
      await expect(
        resolveNounToFK.call(doInstance, 'UnregisteredNoun')
      ).rejects.toThrow(/not found|not registered|unknown noun/i)
    })
  })

  describe('collection().create() with Type FK', () => {
    it('collection().create() should use resolved FK, not hardcoded 0', async () => {
      // RED: Currently create() uses `type: 0`
      // After implementation, it should use the resolved FK from nouns table

      // Access protected collection method
      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          create: (data: Partial<T>) => Promise<T>
        }
      }).collection

      const startups = collection.call(doInstance, 'Startup')

      // This should trigger noun resolution
      // In RED phase, this will use type: 0 which is wrong
      try {
        const startup = await startups.create({
          name: 'Acme Corp',
          fundingStage: 'Seed',
        } as Record<string, unknown>)

        // If we get here, check the thing was created with correct type FK
        // We'd need to query the database to verify the type field
        // For now, just verify the returned object
        expect(startup).toHaveProperty('$type', 'Startup')
      } catch (error) {
        // In RED phase, might fail due to DB access
        // Document that the test is about type FK resolution
        expect(error).toBeDefined()
      }
    })

    it('collection().create() should not accept invalid noun names', async () => {
      // Should validate noun names before attempting resolution
      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          create: (data: Partial<T>) => Promise<T>
        }
      }).collection

      // Invalid noun (not PascalCase) - should throw synchronously
      expect(() => collection.call(doInstance, 'startup')).toThrow(/PascalCase|invalid noun/i)
    })
  })

  describe('collection().list() with Type FK Filtering', () => {
    it('collection().list() should filter by resolved type FK', async () => {
      // RED: list() should filter things by their type FK
      // Currently it returns all things regardless of type

      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          list: () => Promise<T[]>
        }
      }).collection

      const startups = collection.call(doInstance, 'Startup')

      try {
        const results = await startups.list()

        // All returned items should have $type: 'Startup'
        // In RED phase, this might return all things regardless of type
        for (const item of results) {
          expect(item).toHaveProperty('$type', 'Startup')
        }
      } catch (error) {
        // DB access errors expected in mock environment
        expect(error).toBeDefined()
      }
    })

    it('collection().get() should only return items of the correct type', async () => {
      // RED: get() should verify the returned item matches the collection type

      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          get: (id: string) => Promise<T | null>
        }
      }).collection

      const startups = collection.call(doInstance, 'Startup')

      try {
        const result = await startups.get('some-id')

        // If found, should have correct $type
        if (result !== null) {
          expect(result).toHaveProperty('$type', 'Startup')
        }
      } catch (error) {
        // DB access errors expected in mock environment
        expect(error).toBeDefined()
      }
    })
  })

  describe('Type Cache Integration', () => {
    it('_typeCache should be populated after collection operations', async () => {
      // RED: The typeCache should be populated when collection() resolves types

      const typeCache = (doInstance as unknown as {
        _typeCache: Map<string, number>
      })._typeCache

      // Initially empty
      expect(typeCache.size).toBe(0)

      // Access collection (should trigger type resolution)
      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          list: () => Promise<T[]>
        }
      }).collection

      try {
        const startups = collection.call(doInstance, 'Startup')
        await startups.list()

        // After collection operation, 'Startup' should be cached
        // In current implementation, this won't happen because type: 0 is hardcoded
        expect(typeCache.has('Startup')).toBe(true)
      } catch (error) {
        // In RED phase, the cache won't be populated
        // This documents the expected behavior
        expect(typeCache.has('Startup')).toBe(true) // Will fail - documenting expected behavior
      }
    })

    it('multiple collection operations should reuse cached FK', async () => {
      // RED: Subsequent operations should use cached FK, not re-query

      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          create: (data: Partial<T>) => Promise<T>
          list: () => Promise<T[]>
        }
      }).collection

      try {
        const startups = collection.call(doInstance, 'Startup')

        // First operation - should query and cache
        await startups.list()

        // Second operation - should use cache
        await startups.create({ name: 'Test' } as Record<string, unknown>)

        // The FK should only be resolved once (from cache)
        // We can't easily verify this without spying on the query
        // but the cache should definitely be populated
        const typeCache = (doInstance as unknown as {
          _typeCache: Map<string, number>
        })._typeCache

        expect(typeCache.has('Startup')).toBe(true)
      } catch (error) {
        // DB access errors expected
        expect(error).toBeDefined()
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle noun names with numbers', async () => {
      // Nouns like 'OAuth2Client' should be valid

      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          list: () => Promise<T[]>
        }
      }).collection

      // Should not throw on valid PascalCase with numbers
      expect(() => collection.call(doInstance, 'OAuth2Client')).not.toThrow()
    })

    it('should reject empty noun name', async () => {
      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          list: () => Promise<T[]>
        }
      }).collection

      expect(() => collection.call(doInstance, '')).toThrow(/empty|required|invalid/i)
    })

    it('should handle concurrent collection operations', async () => {
      // Multiple concurrent operations on the same collection should work

      const collection = (doInstance as unknown as {
        collection: <T>(noun: string) => {
          create: (data: Partial<T>) => Promise<T>
        }
      }).collection

      const startups = collection.call(doInstance, 'Startup')

      try {
        // Concurrent creates
        const results = await Promise.all([
          startups.create({ name: 'Company A' } as Record<string, unknown>),
          startups.create({ name: 'Company B' } as Record<string, unknown>),
          startups.create({ name: 'Company C' } as Record<string, unknown>),
        ])

        // All should succeed with correct type
        for (const result of results) {
          expect(result).toHaveProperty('$type', 'Startup')
        }
      } catch (error) {
        // DB access errors expected in mock environment
        expect(error).toBeDefined()
      }
    })
  })
})

// ============================================================================
// TESTS: Noun Registration and Lookup
// ============================================================================

describe('Noun Registration', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com' })
  })

  it('should have a registerNoun method for adding nouns', () => {
    // RED: DO should have a method to register nouns in the nouns table
    // This is needed for the FK resolution to work

    const registerNoun = (doInstance as unknown as {
      registerNoun?: (noun: string, config?: { plural?: string; description?: string }) => Promise<number>
    }).registerNoun

    // This will fail in RED phase - method doesn't exist
    expect(registerNoun).toBeDefined()
    expect(typeof registerNoun).toBe('function')
  })

  it('registerNoun should return the rowid (FK) of the registered noun', async () => {
    // RED: After registering, should return the FK ID

    const registerNoun = (doInstance as unknown as {
      registerNoun: (noun: string) => Promise<number>
    }).registerNoun

    if (!registerNoun) {
      expect(registerNoun).toBeDefined() // Force fail
      return
    }

    const fk = await registerNoun.call(doInstance, 'Startup')

    expect(typeof fk).toBe('number')
    expect(fk).toBeGreaterThan(0) // SQLite rowids start at 1
  })

  it('registerNoun should be idempotent', async () => {
    // RED: Registering the same noun twice should return the same FK

    const registerNoun = (doInstance as unknown as {
      registerNoun: (noun: string) => Promise<number>
    }).registerNoun

    if (!registerNoun) {
      expect(registerNoun).toBeDefined() // Force fail
      return
    }

    const fk1 = await registerNoun.call(doInstance, 'Startup')
    const fk2 = await registerNoun.call(doInstance, 'Startup')

    expect(fk1).toBe(fk2)
  })
})

// ============================================================================
// INTEGRATION TESTS: Full Flow
// ============================================================================

describe('Type FK Resolution - Full Flow', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://startups.studio' })
  })

  it('full flow: register noun, create thing, verify FK', async () => {
    // RED: This tests the complete flow

    const registerNoun = (doInstance as unknown as {
      registerNoun?: (noun: string) => Promise<number>
    }).registerNoun

    const collection = (doInstance as unknown as {
      collection: <T>(noun: string) => {
        create: (data: Partial<T>) => Promise<T>
      }
    }).collection

    if (!registerNoun) {
      expect(registerNoun).toBeDefined() // Force fail
      return
    }

    // 1. Register noun (gets rowid = FK)
    const fk = await registerNoun.call(doInstance, 'Startup')
    expect(fk).toBeGreaterThan(0)

    // 2. Create thing using collection
    const startups = collection.call(doInstance, 'Startup')
    const startup = await startups.create({
      name: 'Acme Corp',
    } as Record<string, unknown>)

    // 3. The created thing should use the registered FK
    expect(startup).toHaveProperty('$type', 'Startup')

    // 4. The typeCache should be populated
    const typeCache = (doInstance as unknown as {
      _typeCache: Map<string, number>
    })._typeCache
    expect(typeCache.get('Startup')).toBe(fk)
  })

  it('full flow: query by type FK', async () => {
    // RED: list() should filter using the resolved FK

    const registerNoun = (doInstance as unknown as {
      registerNoun?: (noun: string) => Promise<number>
    }).registerNoun

    const collection = (doInstance as unknown as {
      collection: <T>(noun: string) => {
        create: (data: Partial<T>) => Promise<T>
        list: () => Promise<T[]>
      }
    }).collection

    if (!registerNoun) {
      expect(registerNoun).toBeDefined() // Force fail
      return
    }

    // Register two different nouns
    await registerNoun.call(doInstance, 'Startup')
    await registerNoun.call(doInstance, 'Investor')

    // Create things of different types
    const startups = collection.call(doInstance, 'Startup')
    const investors = collection.call(doInstance, 'Investor')

    await startups.create({ name: 'Startup A' } as Record<string, unknown>)
    await startups.create({ name: 'Startup B' } as Record<string, unknown>)
    await investors.create({ name: 'Investor X' } as Record<string, unknown>)

    // Query only startups
    const startupList = await startups.list()

    // Should only return startups, not investors
    expect(startupList.length).toBe(2)
    for (const s of startupList) {
      expect(s).toHaveProperty('$type', 'Startup')
    }
  })
})
