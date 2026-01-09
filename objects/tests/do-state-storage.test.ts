/**
 * StateStorage Tests
 *
 * RED TDD: Tests for StateStorage - type-safe wrapper around Durable Object state API.
 *
 * StateStorage provides:
 * - Type-safe get/set/delete operations
 * - Batch read/write
 * - Transactions
 * - Optional JSON schema validation
 * - State versioning/migration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports define the interface we need to implement
import {
  StateStorage,
  type StateStorageOptions,
  StateStorageError,
  StateValidationError,
  StateMigrationError,
} from '../StateStorage'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()
  const transactionStack: Map<string, unknown>[] = []

  return {
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
        const current = transactionStack.length > 0 ? transactionStack[transactionStack.length - 1] : storage
        return current.get(key) as T | undefined
      }),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        const current = transactionStack.length > 0 ? transactionStack[transactionStack.length - 1] : storage
        current.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => {
        const current = transactionStack.length > 0 ? transactionStack[transactionStack.length - 1] : storage
        return current.delete(key)
      }),
      deleteAll: vi.fn(async (): Promise<void> => {
        const current = transactionStack.length > 0 ? transactionStack[transactionStack.length - 1] : storage
        current.clear()
      }),
      list: vi.fn(async <T>(options?: { prefix?: string; limit?: number; start?: string; end?: string }): Promise<Map<string, T>> => {
        const result = new Map<string, T>()
        const current = transactionStack.length > 0 ? transactionStack[transactionStack.length - 1] : storage
        let count = 0
        for (const [key, value] of current) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          if (options?.start && key < options.start) continue
          if (options?.end && key >= options.end) continue
          if (options?.limit && count >= options.limit) break
          result.set(key, value as T)
          count++
        }
        return result
      }),
      getAlarm: vi.fn(async () => null),
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
      transaction: vi.fn(async <T>(closure: () => Promise<T>): Promise<T> => {
        // Create a snapshot for transaction
        const snapshot = new Map(storage)
        transactionStack.push(snapshot)
        try {
          const result = await closure()
          // Commit: merge snapshot back to storage
          for (const [key, value] of snapshot) {
            storage.set(key, value)
          }
          // Remove deleted keys
          for (const key of storage.keys()) {
            if (!snapshot.has(key)) {
              storage.delete(key)
            }
          }
          transactionStack.pop()
          return result
        } catch (error) {
          // Rollback: discard snapshot
          transactionStack.pop()
          throw error
        }
      }),
    },
    _storage: storage,
  }
}

function createMockState() {
  const { storage, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-state-storage-do-id' },
    storage,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

// ============================================================================
// TEST TYPES
// ============================================================================

interface User {
  name: string
  age: number
  email?: string
}

interface Config {
  theme: 'light' | 'dark'
  notifications: boolean
  version: number
}

// ============================================================================
// TESTS
// ============================================================================

describe('StateStorage', () => {
  let mockState: ReturnType<typeof createMockState>
  let storage: StateStorage

  beforeEach(() => {
    mockState = createMockState()
  })

  // ==========================================================================
  // 1. CONSTRUCTOR & INITIALIZATION
  // ==========================================================================

  describe('Constructor & Initialization', () => {
    it('creates storage wrapper from DO state', () => {
      storage = new StateStorage(mockState)

      expect(storage).toBeDefined()
    })

    it('accepts optional configuration', () => {
      const options: StateStorageOptions = {
        prefix: 'app:',
        defaultTTL: 3600,
      }

      storage = new StateStorage(mockState, options)

      expect(storage).toBeDefined()
    })

    it('accepts schema validators option', () => {
      storage = new StateStorage(mockState, {
        validators: {
          user: (value: unknown) => {
            if (typeof value !== 'object' || value === null) return false
            const obj = value as Record<string, unknown>
            return typeof obj.name === 'string' && typeof obj.age === 'number'
          },
        },
      })

      expect(storage).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. BASIC GET/SET/DELETE
  // ==========================================================================

  describe('Basic Get/Set/Delete', () => {
    beforeEach(() => {
      storage = new StateStorage(mockState)
    })

    it('sets and gets a value', async () => {
      await storage.set('user', { name: 'John', age: 30 })
      const user = await storage.get<User>('user')

      expect(user).toEqual({ name: 'John', age: 30 })
    })

    it('returns undefined for non-existent key', async () => {
      const value = await storage.get<User>('nonexistent')

      expect(value).toBeUndefined()
    })

    it('returns default value for non-existent key when provided', async () => {
      const value = await storage.get<number>('counter', 0)

      expect(value).toBe(0)
    })

    it('deletes a value', async () => {
      await storage.set('key', 'value')
      const deleted = await storage.delete('key')
      const value = await storage.get('key')

      expect(deleted).toBe(true)
      expect(value).toBeUndefined()
    })

    it('returns false when deleting non-existent key', async () => {
      const deleted = await storage.delete('nonexistent')

      expect(deleted).toBe(false)
    })

    it('checks if key exists', async () => {
      await storage.set('exists', 'value')

      expect(await storage.has('exists')).toBe(true)
      expect(await storage.has('nonexistent')).toBe(false)
    })

    it('supports type-safe get with generic parameter', async () => {
      const user: User = { name: 'Alice', age: 25, email: 'alice@example.com' }
      await storage.set('user', user)

      const retrieved = await storage.get<User>('user')

      // TypeScript should infer retrieved as User | undefined
      expect(retrieved?.name).toBe('Alice')
      expect(retrieved?.email).toBe('alice@example.com')
    })

    it('handles null values correctly', async () => {
      await storage.set('nullable', null)
      const value = await storage.get('nullable')

      expect(value).toBeNull()
    })

    it('handles complex nested objects', async () => {
      const complex = {
        users: [{ name: 'A' }, { name: 'B' }],
        metadata: {
          nested: {
            deeply: { value: 42 },
          },
        },
      }

      await storage.set('complex', complex)
      const retrieved = await storage.get('complex')

      expect(retrieved).toEqual(complex)
    })
  })

  // ==========================================================================
  // 3. BATCH OPERATIONS
  // ==========================================================================

  describe('Batch Operations', () => {
    beforeEach(() => {
      storage = new StateStorage(mockState)
    })

    it('gets multiple values at once', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      const values = await storage.getMany<string>(['key1', 'key2', 'key3'])

      expect(values).toEqual({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      })
    })

    it('returns undefined for non-existent keys in batch get', async () => {
      await storage.set('key1', 'value1')

      const values = await storage.getMany<string>(['key1', 'missing'])

      expect(values).toEqual({
        key1: 'value1',
        missing: undefined,
      })
    })

    it('sets multiple values at once', async () => {
      await storage.setMany({
        config: { theme: 'dark', notifications: true, version: 1 },
        counter: 42,
        name: 'test',
      })

      expect(await storage.get('config')).toEqual({ theme: 'dark', notifications: true, version: 1 })
      expect(await storage.get('counter')).toBe(42)
      expect(await storage.get('name')).toBe('test')
    })

    it('deletes multiple keys at once', async () => {
      await storage.set('a', 1)
      await storage.set('b', 2)
      await storage.set('c', 3)

      const deleted = await storage.deleteMany(['a', 'b'])

      expect(deleted).toBe(2)
      expect(await storage.has('a')).toBe(false)
      expect(await storage.has('b')).toBe(false)
      expect(await storage.has('c')).toBe(true)
    })

    it('lists keys with optional prefix', async () => {
      await storage.set('user:1', { name: 'Alice' })
      await storage.set('user:2', { name: 'Bob' })
      await storage.set('config', { setting: true })

      const userKeys = await storage.list({ prefix: 'user:' })

      expect(userKeys.size).toBe(2)
      expect(userKeys.has('user:1')).toBe(true)
      expect(userKeys.has('user:2')).toBe(true)
    })

    it('lists keys with limit', async () => {
      await storage.set('a', 1)
      await storage.set('b', 2)
      await storage.set('c', 3)

      const limited = await storage.list({ limit: 2 })

      expect(limited.size).toBe(2)
    })

    it('clears all values', async () => {
      await storage.set('a', 1)
      await storage.set('b', 2)

      await storage.clear()

      expect(await storage.has('a')).toBe(false)
      expect(await storage.has('b')).toBe(false)
    })

    it('clears values with prefix', async () => {
      await storage.set('user:1', 1)
      await storage.set('user:2', 2)
      await storage.set('config', 'keep')

      await storage.clear({ prefix: 'user:' })

      expect(await storage.has('user:1')).toBe(false)
      expect(await storage.has('user:2')).toBe(false)
      expect(await storage.has('config')).toBe(true)
    })
  })

  // ==========================================================================
  // 4. TRANSACTIONS
  // ==========================================================================

  describe('Transactions', () => {
    beforeEach(() => {
      storage = new StateStorage(mockState)
    })

    it('executes transaction with read and write', async () => {
      await storage.set('counter', 10)

      await storage.transaction(async (tx) => {
        const count = await tx.get<number>('counter') ?? 0
        await tx.set('counter', count + 1)
      })

      expect(await storage.get('counter')).toBe(11)
    })

    it('commits all changes on success', async () => {
      await storage.transaction(async (tx) => {
        await tx.set('a', 1)
        await tx.set('b', 2)
        await tx.set('c', 3)
      })

      expect(await storage.get('a')).toBe(1)
      expect(await storage.get('b')).toBe(2)
      expect(await storage.get('c')).toBe(3)
    })

    it('rolls back all changes on error', async () => {
      await storage.set('original', 'value')

      await expect(
        storage.transaction(async (tx) => {
          await tx.set('original', 'modified')
          await tx.set('new', 'data')
          throw new Error('Rollback test')
        }),
      ).rejects.toThrow('Rollback test')

      expect(await storage.get('original')).toBe('value')
      expect(await storage.has('new')).toBe(false)
    })

    it('returns value from transaction', async () => {
      await storage.set('value', 42)

      const result = await storage.transaction(async (tx) => {
        const current = await tx.get<number>('value') ?? 0
        const doubled = current * 2
        await tx.set('value', doubled)
        return doubled
      })

      expect(result).toBe(84)
    })

    it('supports delete within transaction', async () => {
      await storage.set('toDelete', 'value')

      await storage.transaction(async (tx) => {
        await tx.delete('toDelete')
        await tx.set('newKey', 'newValue')
      })

      expect(await storage.has('toDelete')).toBe(false)
      expect(await storage.get('newKey')).toBe('newValue')
    })

    it('provides isolated reads within transaction', async () => {
      await storage.set('shared', 'original')

      await storage.transaction(async (tx) => {
        await tx.set('shared', 'modified')
        const value = await tx.get('shared')
        expect(value).toBe('modified')
      })
    })
  })

  // ==========================================================================
  // 5. VALIDATION
  // ==========================================================================

  describe('Validation', () => {
    it('validates value on set when validator provided', async () => {
      storage = new StateStorage(mockState, {
        validators: {
          user: (value: unknown): value is User => {
            if (typeof value !== 'object' || value === null) return false
            const obj = value as Record<string, unknown>
            return typeof obj.name === 'string' && typeof obj.age === 'number'
          },
        },
      })

      // Valid user should work
      await storage.set('user', { name: 'John', age: 30 })
      expect(await storage.get('user')).toEqual({ name: 'John', age: 30 })

      // Invalid user should throw
      await expect(storage.set('user', { name: 'Invalid' })).rejects.toThrow(StateValidationError)
    })

    it('validates value on get when validator provided', async () => {
      storage = new StateStorage(mockState, {
        validators: {
          config: (value: unknown): value is Config => {
            if (typeof value !== 'object' || value === null) return false
            const obj = value as Record<string, unknown>
            return (
              (obj.theme === 'light' || obj.theme === 'dark') &&
              typeof obj.notifications === 'boolean' &&
              typeof obj.version === 'number'
            )
          },
        },
        validateOnGet: true,
      })

      // Manually set invalid data in wrapped format (bypassing set validation)
      const now = Date.now()
      mockState._storage.set('config', {
        value: { theme: 'invalid', notifications: 'not-bool', version: 'not-number' },
        createdAt: now,
        updatedAt: now,
      })

      // Getting should throw validation error
      await expect(storage.get('config')).rejects.toThrow(StateValidationError)
    })

    it('skips validation for keys without validators', async () => {
      storage = new StateStorage(mockState, {
        validators: {
          user: () => true,
        },
      })

      // Key 'other' has no validator, should work
      await storage.set('other', { anything: 'goes' })
      expect(await storage.get('other')).toEqual({ anything: 'goes' })
    })

    it('supports custom error messages in validators', async () => {
      storage = new StateStorage(mockState, {
        validators: {
          age: (value: unknown): value is number => {
            if (typeof value !== 'number') return false
            if (value < 0 || value > 150) return false
            return true
          },
        },
      })

      await expect(storage.set('age', -5)).rejects.toThrow(StateValidationError)
      await expect(storage.set('age', 200)).rejects.toThrow(StateValidationError)
    })
  })

  // ==========================================================================
  // 6. STATE VERSIONING & MIGRATION
  // ==========================================================================

  describe('State Versioning & Migration', () => {
    it('stores version metadata with values', async () => {
      storage = new StateStorage(mockState, {
        versioned: true,
        version: 1,
      })

      await storage.set('data', { value: 'test' })

      // Internal metadata should include version
      const meta = await storage.getMetadata('data')
      expect(meta?.version).toBe(1)
    })

    it('runs migrations on get when version mismatch', async () => {
      // Create storage with version 1 and seed data
      const v1Storage = new StateStorage(mockState, {
        versioned: true,
        version: 1,
      })
      await v1Storage.set('user', { name: 'John', fullName: undefined })

      // Create storage with version 2 and migration
      const v2Storage = new StateStorage(mockState, {
        versioned: true,
        version: 2,
        migrations: {
          user: {
            1: (data: { name: string }) => ({
              ...data,
              fullName: data.name,
              migrated: true,
            }),
          },
        },
      })

      const user = await v2Storage.get<{ name: string; fullName: string; migrated: boolean }>('user')

      expect(user?.fullName).toBe('John')
      expect(user?.migrated).toBe(true)
    })

    it('runs multiple migrations in sequence', async () => {
      // Setup v1 data with proper wrapped format
      const now = Date.now()
      mockState._storage.set('user', { value: { count: 0 }, version: 1, createdAt: now, updatedAt: now })

      const storage = new StateStorage(mockState, {
        versioned: true,
        version: 4,
        migrations: {
          user: {
            1: (data: { count: number }) => ({ ...data, count: data.count + 1 }), // v1 -> v2
            2: (data: { count: number }) => ({ ...data, count: data.count + 10 }), // v2 -> v3
            3: (data: { count: number }) => ({ ...data, count: data.count + 100 }), // v3 -> v4
          },
        },
      })

      const result = await storage.get<{ count: number }>('user')

      // 0 + 1 + 10 + 100 = 111
      expect(result?.count).toBe(111)
    })

    it('throws on migration error', async () => {
      const now = Date.now()
      mockState._storage.set('data', { value: 'old', version: 1, createdAt: now, updatedAt: now })

      const storage = new StateStorage(mockState, {
        versioned: true,
        version: 2,
        migrations: {
          data: {
            1: () => {
              throw new Error('Migration failed')
            },
          },
        },
      })

      await expect(storage.get('data')).rejects.toThrow(StateMigrationError)
    })

    it('skips migration when version matches', async () => {
      const migrationFn = vi.fn((data: unknown) => data)

      const now = Date.now()
      mockState._storage.set('data', { value: 'current', version: 2, createdAt: now, updatedAt: now })

      const storage = new StateStorage(mockState, {
        versioned: true,
        version: 2,
        migrations: {
          data: {
            1: migrationFn,
          },
        },
      })

      await storage.get('data')

      expect(migrationFn).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 7. PREFIXING
  // ==========================================================================

  describe('Prefixing', () => {
    it('applies prefix to all keys', async () => {
      storage = new StateStorage(mockState, { prefix: 'app:' })

      await storage.set('config', { value: 1 })

      // The actual key in storage should be prefixed
      expect(mockState._storage.has('app:config')).toBe(true)
      expect(mockState._storage.has('config')).toBe(false)
    })

    it('strips prefix when reading keys', async () => {
      storage = new StateStorage(mockState, { prefix: 'app:' })

      await storage.set('key', 'value')
      const result = await storage.get('key')

      expect(result).toBe('value')
    })

    it('applies prefix in batch operations', async () => {
      storage = new StateStorage(mockState, { prefix: 'test:' })

      await storage.setMany({
        a: 1,
        b: 2,
      })

      expect(mockState._storage.has('test:a')).toBe(true)
      expect(mockState._storage.has('test:b')).toBe(true)
    })

    it('applies prefix in list operations', async () => {
      storage = new StateStorage(mockState, { prefix: 'ns:' })

      await storage.set('user:1', { name: 'Alice' })
      await storage.set('user:2', { name: 'Bob' })
      mockState._storage.set('other:1', { name: 'Other' }) // Not prefixed with ns:

      const users = await storage.list({ prefix: 'user:' })

      expect(users.size).toBe(2)
      // Keys should be returned without the storage prefix
      expect(users.has('user:1')).toBe(true)
      expect(users.has('user:2')).toBe(true)
    })
  })

  // ==========================================================================
  // 8. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(() => {
      storage = new StateStorage(mockState)
    })

    it('wraps storage errors in StateStorageError', async () => {
      mockState.storage.put = vi.fn().mockRejectedValue(new Error('Storage failure'))

      await expect(storage.set('key', 'value')).rejects.toThrow(StateStorageError)
    })

    it('includes key in error context', async () => {
      mockState.storage.get = vi.fn().mockRejectedValue(new Error('Read failure'))

      try {
        await storage.get('problematic-key')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StateStorageError)
        expect((error as StateStorageError).key).toBe('problematic-key')
      }
    })

    it('handles undefined storage gracefully', async () => {
      const badState = { storage: null } as unknown as DurableObjectState

      expect(() => new StateStorage(badState)).toThrow()
    })
  })

  // ==========================================================================
  // 9. STORAGE LIMITS
  // ==========================================================================

  describe('Storage Limits', () => {
    beforeEach(() => {
      storage = new StateStorage(mockState)
    })

    it('warns when value size exceeds threshold', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const largeValue = 'x'.repeat(100 * 1024) // 100KB

      await storage.set('large', largeValue, { warnOnLargeValue: true, largeValueThreshold: 50 * 1024 })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('large value'))
      warnSpy.mockRestore()
    })

    it('rejects values exceeding max size when configured', async () => {
      storage = new StateStorage(mockState, {
        maxValueSize: 1024, // 1KB
      })

      const oversizedValue = 'x'.repeat(2 * 1024) // 2KB

      await expect(storage.set('oversized', oversizedValue)).rejects.toThrow(StateStorageError)
    })

    it('tracks storage usage statistics', async () => {
      await storage.set('a', 'value1')
      await storage.set('b', 'value2')

      const stats = await storage.getStats()

      expect(stats.keyCount).toBe(2)
      expect(stats.estimatedSize).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 10. METADATA & UTILITIES
  // ==========================================================================

  describe('Metadata & Utilities', () => {
    beforeEach(() => {
      storage = new StateStorage(mockState, { versioned: true, version: 1 })
    })

    it('stores and retrieves metadata', async () => {
      await storage.set('data', { value: 'test' })

      const meta = await storage.getMetadata('data')

      expect(meta).toBeDefined()
      expect(meta?.createdAt).toBeDefined()
      expect(meta?.updatedAt).toBeDefined()
    })

    it('updates metadata on modification', async () => {
      await storage.set('data', { value: 'initial' })
      const meta1 = await storage.getMetadata('data')

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      await storage.set('data', { value: 'updated' })
      const meta2 = await storage.getMetadata('data')

      expect(meta2?.updatedAt).not.toBe(meta1?.updatedAt)
    })

    it('returns keys matching pattern', async () => {
      await storage.set('user:1:profile', { name: 'Alice' })
      await storage.set('user:1:settings', { theme: 'dark' })
      await storage.set('user:2:profile', { name: 'Bob' })

      const keys = await storage.keys({ prefix: 'user:1:' })

      expect(keys).toContain('user:1:profile')
      expect(keys).toContain('user:1:settings')
      expect(keys).not.toContain('user:2:profile')
    })

    it('counts keys with optional prefix', async () => {
      await storage.set('user:1', { name: 'Alice' })
      await storage.set('user:2', { name: 'Bob' })
      await storage.set('config', { value: 1 })

      expect(await storage.count()).toBe(3)
      expect(await storage.count({ prefix: 'user:' })).toBe(2)
    })
  })

  // ==========================================================================
  // 11. TTL SUPPORT
  // ==========================================================================

  describe('TTL Support', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      storage = new StateStorage(mockState)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sets value with TTL', async () => {
      await storage.set('temporary', 'value', { ttl: 1000 }) // 1 second TTL

      expect(await storage.get('temporary')).toBe('value')
    })

    it('returns undefined for expired values', async () => {
      await storage.set('expiring', 'value', { ttl: 1000 })

      vi.advanceTimersByTime(1500) // Advance past TTL

      expect(await storage.get('expiring')).toBeUndefined()
    })

    it('uses default TTL when configured', async () => {
      storage = new StateStorage(mockState, { defaultTTL: 500 })

      await storage.set('data', 'value')

      vi.advanceTimersByTime(600)

      expect(await storage.get('data')).toBeUndefined()
    })

    it('refreshes TTL on update', async () => {
      await storage.set('data', 'value1', { ttl: 1000 })

      vi.advanceTimersByTime(500)

      await storage.set('data', 'value2', { ttl: 1000 })

      vi.advanceTimersByTime(700) // Total: 1200ms, but TTL was refreshed at 500ms

      expect(await storage.get('data')).toBe('value2')
    })

    it('allows explicit no-TTL override', async () => {
      storage = new StateStorage(mockState, { defaultTTL: 1000 })

      await storage.set('permanent', 'value', { ttl: 0 }) // Explicit no TTL

      vi.advanceTimersByTime(2000)

      expect(await storage.get('permanent')).toBe('value')
    })
  })
})
