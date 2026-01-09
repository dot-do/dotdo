/**
 * DO resolveLocal() Tests
 *
 * TDD GREEN PHASE: Tests for resolving local Thing references.
 *
 * resolveLocal(path, ref) should:
 * - Parse Noun/id format using lib/noun-id.ts parseNounId()
 * - Query things table for matching id
 * - Filter by branch (use ref or currentBranch)
 * - Handle version references (@v1234, @~1)
 * - Return Thing with proper $id, $type
 *
 * Examples:
 * - resolveLocal('Startup/acme', 'main') - get thing from main branch
 * - resolveLocal('Startup/acme', 'experiment') - get thing from experiment branch
 * - resolveLocal('Startup/acme@v1234', 'main') - get specific version
 * - resolveLocal('Startup/acme@~1', 'main') - get relative version (one back)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import { parseNounId } from '../../lib/noun-id'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

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

function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

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
  } as unknown as DurableObjectState
}

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: ReturnType<typeof createMockSqlStorage>
}

// ============================================================================
// EXTENDED DO FOR TESTING
// ============================================================================

/**
 * Extended DO class that exposes protected methods for testing
 */
class TestDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state as any, env as any)
  }

  // Expose protected resolveLocal for testing
  async testResolveLocal(path: string, ref: string) {
    return this.resolveLocal(path, ref)
  }

  // Expose currentBranch for testing
  get testCurrentBranch() {
    return this.currentBranch
  }

  // Set currentBranch for testing
  set testCurrentBranch(branch: string) {
    this.currentBranch = branch
  }

  // Get ns for testing
  get testNs() {
    return this.ns
  }
}

// ============================================================================
// TEST SUITE: Noun ID Parsing (Unit tests - no DB required)
// ============================================================================

describe('noun-id parsing integration', () => {
  it('correctly parses simple Noun/id', () => {
    const parsed = parseNounId('Startup/acme')
    expect(parsed.noun).toBe('Startup')
    expect(parsed.id).toBe('acme')
    expect(parsed.branch).toBeUndefined()
    expect(parsed.version).toBeUndefined()
  })

  it('correctly parses Noun/id with branch', () => {
    const parsed = parseNounId('Startup/acme@experiment')
    expect(parsed.noun).toBe('Startup')
    expect(parsed.id).toBe('acme')
    expect(parsed.branch).toBe('experiment')
  })

  it('correctly parses Noun/id with version', () => {
    const parsed = parseNounId('Startup/acme@v1234')
    expect(parsed.noun).toBe('Startup')
    expect(parsed.id).toBe('acme')
    expect(parsed.version).toBe(1234)
  })

  it('correctly parses Noun/id with relative version', () => {
    const parsed = parseNounId('Startup/acme@~1')
    expect(parsed.noun).toBe('Startup')
    expect(parsed.id).toBe('acme')
    expect(parsed.relativeVersion).toBe(1)
  })

  it('correctly parses nested Noun/id path', () => {
    const parsed = parseNounId('Startup/acme/Product/widget')
    expect(parsed.noun).toBe('Startup')
    expect(parsed.id).toBe('acme')
    expect(parsed.path?.noun).toBe('Product')
    expect(parsed.path?.id).toBe('widget')
  })

  it('throws for invalid Noun/id format - missing id', () => {
    expect(() => parseNounId('invalid')).toThrow()
  })

  it('throws for empty input', () => {
    expect(() => parseNounId('')).toThrow()
  })

  it('throws for invalid noun (not PascalCase)', () => {
    expect(() => parseNounId('startup/acme')).toThrow(/PascalCase/)
  })
})

// ============================================================================
// TEST SUITE: resolveLocal Implementation (requires Workers runtime)
// These tests verify the actual implementation behavior
// ============================================================================

describe.skip('resolveLocal with database (requires Workers runtime)', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. BASIC RESOLUTION
  // ==========================================================================

  describe('basic resolution', () => {
    it('resolves Noun/id format from main branch', async () => {
      // Setup: Create a thing in the database via things store
      await doInstance.things.create({
        $id: 'acme',
        $type: 'Startup',
        name: 'Acme Inc',
        data: { industry: 'tech' },
      })

      // When resolving 'Startup/acme' with ref 'main'
      const thing = await doInstance.testResolveLocal('Startup/acme', 'main')

      // Then it should return the thing from main branch
      expect(thing.$type).toBe('Startup')
      expect(thing.name).toBe('Acme Inc')
    })

    it('returns Thing with correct $id format', async () => {
      await doInstance.things.create({
        $id: 'acme',
        $type: 'Startup',
        name: 'Acme Inc',
      })

      // The returned Thing.$id should include namespace and path
      const thing = await doInstance.testResolveLocal('Startup/acme', 'main')

      expect(thing.$id).toContain('Startup/acme')
    })

    it('returns Thing with correct $type format', async () => {
      await doInstance.things.create({
        $id: 'acme',
        $type: 'Startup',
        name: 'Acme Inc',
      })

      // The returned Thing.$type should be the noun type
      const thing = await doInstance.testResolveLocal('Startup/acme', 'main')

      expect(thing.$type).toBe('Startup')
    })
  })

  // ==========================================================================
  // 2. BRANCH RESOLUTION
  // ==========================================================================

  describe('branch resolution', () => {
    it('resolves thing from specified branch', async () => {
      // Create thing on experiment branch
      await doInstance.things.create(
        {
          $id: 'acme',
          $type: 'Startup',
          name: 'Acme Experiment',
        },
        { branch: 'experiment' }
      )

      // When resolving with ref='experiment'
      const thing = await doInstance.testResolveLocal('Startup/acme', 'experiment')

      // Then it should return thing from experiment branch
      expect(thing.name).toBe('Acme Experiment')
    })

    it('uses currentBranch when no ref specified', async () => {
      // Set currentBranch to 'feature'
      doInstance.testCurrentBranch = 'feature'

      await doInstance.things.create(
        {
          $id: 'acme',
          $type: 'Startup',
          name: 'Feature Branch Version',
        },
        { branch: 'feature' }
      )

      // Resolving with empty ref should use currentBranch
      const thing = await doInstance.testResolveLocal('Startup/acme', '')

      expect(thing.name).toBe('Feature Branch Version')
    })

    it('respects branch from path over ref parameter', async () => {
      // Create thing on experiment branch
      await doInstance.things.create(
        {
          $id: 'acme',
          $type: 'Startup',
          name: 'Acme Experiment',
        },
        { branch: 'experiment' }
      )

      // Resolve with branch in path - should use experiment not main
      const thing = await doInstance.testResolveLocal('Startup/acme@experiment', 'main')

      expect(thing.name).toBe('Acme Experiment')
    })
  })

  // ==========================================================================
  // 3. VERSION RESOLUTION
  // ==========================================================================

  describe('version resolution', () => {
    it('resolves specific version with @vNNNN format', async () => {
      // Create multiple versions
      await doInstance.things.create({
        $id: 'evolving',
        $type: 'Startup',
        name: 'Version 1',
      })
      await doInstance.things.update('evolving', { name: 'Version 2' })

      // Resolve specific version
      const thing = await doInstance.testResolveLocal('Startup/evolving@v1', 'main')

      expect(thing.name).toBe('Version 1')
    })

    it('resolves relative version with @~N format', async () => {
      // Create thing with multiple versions
      await doInstance.things.create({
        $id: 'evolving',
        $type: 'Startup',
        name: 'Version 1',
      })
      await doInstance.things.update('evolving', { name: 'Version 2' })
      await doInstance.things.update('evolving', { name: 'Version 3' })

      // Get one version back
      const thing = await doInstance.testResolveLocal('Startup/evolving@~1', 'main')

      expect(thing.name).toBe('Version 2')
    })

    it('resolves relative version @~5 (5 versions back)', async () => {
      // Create thing with 6 versions
      await doInstance.things.create({
        $id: 'evolving',
        $type: 'Startup',
        name: 'Version 1',
      })
      for (let i = 2; i <= 6; i++) {
        await doInstance.things.update('evolving', { name: `Version ${i}` })
      }

      // Get 5 versions back from latest (Version 6)
      const thing = await doInstance.testResolveLocal('Startup/evolving@~5', 'main')

      expect(thing.name).toBe('Version 1')
    })
  })

  // ==========================================================================
  // 4. ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('throws for non-existent thing', async () => {
      await expect(
        doInstance.testResolveLocal('Startup/nonexistent', 'main')
      ).rejects.toThrow('Thing not found')
    })

    it('throws for invalid Noun/id format', async () => {
      await expect(
        doInstance.testResolveLocal('invalid', 'main')
      ).rejects.toThrow()
    })

    it('throws when version does not exist', async () => {
      await doInstance.things.create({
        $id: 'acme',
        $type: 'Startup',
        name: 'Acme Inc',
      })

      // Request version that doesn't exist
      await expect(
        doInstance.testResolveLocal('Startup/acme@v99999', 'main')
      ).rejects.toThrow('Thing not found')
    })

    it('throws when relative version goes beyond available versions', async () => {
      // Create thing with only 2 versions
      await doInstance.things.create({
        $id: 'acme',
        $type: 'Startup',
        name: 'Version 1',
      })
      await doInstance.things.update('acme', { name: 'Version 2' })

      // Request @~10 when only 2 versions exist
      await expect(
        doInstance.testResolveLocal('Startup/acme@~10', 'main')
      ).rejects.toThrow(/exceeds available versions/)
    })
  })
})

// ============================================================================
// TEST SUITE: resolveLocal Implementation Verification
// These tests verify the implementation exists and handles parse errors
// ============================================================================

describe('resolveLocal implementation', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: TestDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new TestDO(mockState, mockEnv)
  })

  it('calls parseNounId with the path', async () => {
    // Invalid path should throw parseNounId error, not "Not implemented"
    await expect(
      doInstance.testResolveLocal('invalid', 'main')
    ).rejects.toThrow(/must have at least Noun\/id format/)
  })

  it('throws parseNounId error for invalid noun', async () => {
    await expect(
      doInstance.testResolveLocal('startup/acme', 'main')
    ).rejects.toThrow(/PascalCase/)
  })

  it('throws parseNounId error for empty path', async () => {
    await expect(
      doInstance.testResolveLocal('', 'main')
    ).rejects.toThrow(/cannot be empty/)
  })

  it('parses version reference correctly', async () => {
    // This will fail at the database level (not "Not implemented")
    // because we don't have a real database, but it proves parseNounId works
    const promise = doInstance.testResolveLocal('Startup/acme@v1234', 'main')

    // Should fail with database error, not parse error
    await expect(promise).rejects.not.toThrow('Not implemented')
    await expect(promise).rejects.not.toThrow(/PascalCase/)
    await expect(promise).rejects.not.toThrow(/Noun\/id format/)
  })

  it('parses relative version correctly', async () => {
    const promise = doInstance.testResolveLocal('Startup/acme@~1', 'main')

    // Should fail with database error, not parse error
    await expect(promise).rejects.not.toThrow('Not implemented')
    await expect(promise).rejects.not.toThrow(/PascalCase/)
  })

  it('parses branch reference correctly', async () => {
    const promise = doInstance.testResolveLocal('Startup/acme@experiment', 'main')

    // Should fail with database error, not parse error
    await expect(promise).rejects.not.toThrow('Not implemented')
    await expect(promise).rejects.not.toThrow(/PascalCase/)
  })
})
