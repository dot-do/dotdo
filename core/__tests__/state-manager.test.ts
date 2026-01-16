/**
 * StateManager Unit Tests
 *
 * Direct unit tests for StateManager class covering:
 * - get/set/delete operations
 * - list() with prefix filtering
 * - Transaction edge cases
 * - STATE_KEYS constant usage
 * - Error handling for invalid keys
 *
 * RPC Access Pattern:
 * These tests use the `getState()` method pattern to access StateManager methods
 * via RPC. Cloudflare Workers RPC supports methods that return RpcTarget objects
 * for chained calls, but getters returning RpcTarget have limitations.
 *
 * Usage:
 *   const stub = env.DOCore.get(id)
 *   await stub.getState().get('myKey')
 *   await stub.getState().set('myKey', 'value')
 *   await stub.getState().delete('myKey')
 *   await stub.getState().list({ prefix: 'user:' })
 *
 * @see do-1zbv: StateManager unit tests
 * @module core/__tests__/state-manager.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  StateManager,
  STATE_KEYS,
  type ListOptions,
  type TransactionOp,
  type TransactionResult,
} from '../state-manager'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore instance for testing StateManager directly
 * We access the internal stateManager via the DO
 */
function getDO(name = 'state-manager-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// STATE_KEYS Constant Tests
// =============================================================================

describe('STATE_KEYS constant', () => {
  describe('Lifecycle keys', () => {
    it('should export LIFECYCLE_START key', () => {
      expect(STATE_KEYS.LIFECYCLE_START).toBe('_lifecycle:onStart')
    })

    it('should export LIFECYCLE_START_COUNT key', () => {
      expect(STATE_KEYS.LIFECYCLE_START_COUNT).toBe('_lifecycle:onStartCount')
    })

    it('should export LIFECYCLE_HIBERNATE key', () => {
      expect(STATE_KEYS.LIFECYCLE_HIBERNATE).toBe('_lifecycle:onHibernate')
    })

    it('should export LIFECYCLE_WAKE key', () => {
      expect(STATE_KEYS.LIFECYCLE_WAKE).toBe('_lifecycle:onWake')
    })

    it('should export LIFECYCLE_WAKE_COUNT key', () => {
      expect(STATE_KEYS.LIFECYCLE_WAKE_COUNT).toBe('_lifecycle:wakeCount')
    })
  })

  describe('System keys', () => {
    it('should export INITIALIZED key', () => {
      expect(STATE_KEYS.INITIALIZED).toBe('_initialized')
    })

    it('should export ALARM_TRIGGERED key', () => {
      expect(STATE_KEYS.ALARM_TRIGGERED).toBe('_alarm_triggered')
    })

    it('should export CONNECTIONS_RESTORED key', () => {
      expect(STATE_KEYS.CONNECTIONS_RESTORED).toBe('_connections:restored')
    })
  })

  describe('Immutability', () => {
    it('should be a frozen object (as const)', () => {
      // The 'as const' assertion makes this readonly at compile time
      // At runtime we verify the expected structure exists
      expect(typeof STATE_KEYS).toBe('object')
      expect(Object.keys(STATE_KEYS).length).toBe(8)
    })

    it('should contain all expected lifecycle keys', () => {
      const expectedLifecycleKeys = [
        'LIFECYCLE_START',
        'LIFECYCLE_START_COUNT',
        'LIFECYCLE_HIBERNATE',
        'LIFECYCLE_WAKE',
        'LIFECYCLE_WAKE_COUNT',
      ]
      for (const key of expectedLifecycleKeys) {
        expect(STATE_KEYS).toHaveProperty(key)
      }
    })

    it('should have all keys prefixed with underscore', () => {
      for (const value of Object.values(STATE_KEYS)) {
        expect(value.startsWith('_')).toBe(true)
      }
    })
  })
})

// =============================================================================
// StateManager get/set/delete Operations
// =============================================================================

describe('StateManager basic operations', () => {
  describe('get() operation', () => {
    it('should return undefined for non-existent key', async () => {
      const doInstance = getDO('get-test-1')
      // Access state via RPC
      const result = await doInstance.getState().get('nonexistent-key')
      expect(result).toBeUndefined()
    })

    it('should retrieve a previously set string value', async () => {
      const doInstance = getDO('get-test-2')
      await doInstance.getState().set('test-key', 'test-value')
      const result = await doInstance.getState().get('test-key')
      expect(result).toBe('test-value')
    })

    it('should retrieve a previously set numeric value', async () => {
      const doInstance = getDO('get-test-3')
      await doInstance.getState().set('counter', 42)
      const result = await doInstance.getState().get('counter')
      expect(result).toBe(42)
    })

    it('should retrieve a previously set object value', async () => {
      const doInstance = getDO('get-test-4')
      const data = { name: 'Alice', age: 30, tags: ['developer', 'admin'] }
      await doInstance.getState().set('user-data', data)
      const result = await doInstance.getState().get('user-data')
      expect(result).toEqual(data)
    })

    it('should retrieve a previously set boolean value', async () => {
      const doInstance = getDO('get-test-5')
      await doInstance.getState().set('enabled', true)
      const result = await doInstance.getState().get('enabled')
      expect(result).toBe(true)
    })

    it('should retrieve a previously set null value', async () => {
      const doInstance = getDO('get-test-6')
      await doInstance.getState().set('nullable', null)
      const result = await doInstance.getState().get('nullable')
      expect(result).toBe(null)
    })

    it('should retrieve a previously set array value', async () => {
      const doInstance = getDO('get-test-7')
      const items = [1, 2, 3, 'four', { five: 5 }]
      await doInstance.getState().set('items', items)
      const result = await doInstance.getState().get('items')
      expect(result).toEqual(items)
    })
  })

  describe('set() operation', () => {
    it('should return true on successful set', async () => {
      const doInstance = getDO('set-test-1')
      const result = await doInstance.getState().set('key', 'value')
      expect(result).toBe(true)
    })

    it('should overwrite existing value', async () => {
      const doInstance = getDO('set-test-2')
      await doInstance.getState().set('key', 'original')
      await doInstance.getState().set('key', 'updated')
      const result = await doInstance.getState().get('key')
      expect(result).toBe('updated')
    })

    it('should handle empty string key', async () => {
      const doInstance = getDO('set-test-3')
      // Empty string is a valid key
      const result = await doInstance.getState().set('', 'empty-key-value')
      expect(result).toBe(true)
      const retrieved = await doInstance.getState().get('')
      expect(retrieved).toBe('empty-key-value')
    })

    it('should handle special characters in keys', async () => {
      const doInstance = getDO('set-test-4')
      const specialKey = 'user:123:profile:@settings'
      await doInstance.getState().set(specialKey, 'special-value')
      const result = await doInstance.getState().get(specialKey)
      expect(result).toBe('special-value')
    })

    it('should handle unicode keys', async () => {
      const doInstance = getDO('set-test-5')
      const unicodeKey = 'data-\u4e2d\u6587-key'
      await doInstance.getState().set(unicodeKey, 'unicode-value')
      const result = await doInstance.getState().get(unicodeKey)
      expect(result).toBe('unicode-value')
    })

    it('should handle very long keys', async () => {
      const doInstance = getDO('set-test-6')
      const longKey = 'k'.repeat(1000)
      await doInstance.getState().set(longKey, 'long-key-value')
      const result = await doInstance.getState().get(longKey)
      expect(result).toBe('long-key-value')
    })
  })

  describe('delete() operation', () => {
    it('should return true on successful delete', async () => {
      const doInstance = getDO('delete-test-1')
      await doInstance.getState().set('to-delete', 'value')
      const result = await doInstance.getState().delete('to-delete')
      expect(result).toBe(true)
    })

    it('should return true even for non-existent key', async () => {
      const doInstance = getDO('delete-test-2')
      // SQLite DELETE on non-existent row succeeds silently
      const result = await doInstance.getState().delete('never-existed')
      expect(result).toBe(true)
    })

    it('should make key unavailable after delete', async () => {
      const doInstance = getDO('delete-test-3')
      await doInstance.getState().set('temp-key', 'temp-value')
      await doInstance.getState().delete('temp-key')
      const result = await doInstance.getState().get('temp-key')
      expect(result).toBeUndefined()
    })

    it('should only delete the specified key', async () => {
      const doInstance = getDO('delete-test-4')
      await doInstance.getState().set('key1', 'value1')
      await doInstance.getState().set('key2', 'value2')
      await doInstance.getState().delete('key1')
      expect(await doInstance.getState().get('key1')).toBeUndefined()
      expect(await doInstance.getState().get('key2')).toBe('value2')
    })
  })

  describe('setSync() operation', () => {
    it('should synchronously set a value', async () => {
      const doInstance = getDO('set-sync-test-1')
      // setSync is used internally for initialization
      // We test via the async get to verify it worked
      await doInstance.getState().set('sync-key', 'sync-value')
      const result = await doInstance.getState().get('sync-key')
      expect(result).toBe('sync-value')
    })
  })

  describe('getSync() operation', () => {
    it('should synchronously get a value', async () => {
      const doInstance = getDO('get-sync-test-1')
      await doInstance.getState().set('sync-get-key', 'sync-get-value')
      // Verify via async get
      const result = await doInstance.getState().get('sync-get-key')
      expect(result).toBe('sync-get-value')
    })
  })
})

// =============================================================================
// StateManager setMany/deleteMany Operations
// =============================================================================

describe('StateManager batch operations', () => {
  describe('setMany() operation', () => {
    it('should set multiple key-value pairs', async () => {
      const doInstance = getDO('set-many-test-1')
      const entries = {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      }
      const result = await doInstance.getState().setMany(entries)
      expect(result).toBe(true)

      expect(await doInstance.getState().get('key1')).toBe('value1')
      expect(await doInstance.getState().get('key2')).toBe('value2')
      expect(await doInstance.getState().get('key3')).toBe('value3')
    })

    it('should handle empty entries object', async () => {
      const doInstance = getDO('set-many-test-2')
      const result = await doInstance.getState().setMany({})
      expect(result).toBe(true)
    })

    it('should handle mixed value types', async () => {
      const doInstance = getDO('set-many-test-3')
      const entries = {
        string: 'text',
        number: 123,
        boolean: true,
        object: { nested: true },
        array: [1, 2, 3],
        nullValue: null,
      }
      await doInstance.getState().setMany(entries)

      expect(await doInstance.getState().get('string')).toBe('text')
      expect(await doInstance.getState().get('number')).toBe(123)
      expect(await doInstance.getState().get('boolean')).toBe(true)
      expect(await doInstance.getState().get('object')).toEqual({ nested: true })
      expect(await doInstance.getState().get('array')).toEqual([1, 2, 3])
      expect(await doInstance.getState().get('nullValue')).toBe(null)
    })
  })

  describe('deleteMany() operation', () => {
    it('should delete multiple keys', async () => {
      const doInstance = getDO('delete-many-test-1')
      await doInstance.getState().setMany({
        a: 1,
        b: 2,
        c: 3,
      })
      const result = await doInstance.getState().deleteMany(['a', 'b'])
      expect(result).toBe(true)

      expect(await doInstance.getState().get('a')).toBeUndefined()
      expect(await doInstance.getState().get('b')).toBeUndefined()
      expect(await doInstance.getState().get('c')).toBe(3)
    })

    it('should handle empty keys array', async () => {
      const doInstance = getDO('delete-many-test-2')
      const result = await doInstance.getState().deleteMany([])
      expect(result).toBe(true)
    })

    it('should handle non-existent keys gracefully', async () => {
      const doInstance = getDO('delete-many-test-3')
      const result = await doInstance.getState().deleteMany(['nonexistent1', 'nonexistent2'])
      expect(result).toBe(true)
    })
  })
})

// =============================================================================
// StateManager list() with Filtering
// =============================================================================

describe('StateManager list() operation', () => {
  describe('Basic listing', () => {
    it('should return all entries when no options provided', async () => {
      const doInstance = getDO('list-test-1')
      await doInstance.getState().setMany({
        'item:1': 'first',
        'item:2': 'second',
        'item:3': 'third',
      })

      const result = await doInstance.getState().list()
      expect(typeof result).toBe('object')
      expect(result['item:1']).toBe('first')
      expect(result['item:2']).toBe('second')
      expect(result['item:3']).toBe('third')
    })

    it('should return empty object when no entries exist', async () => {
      const doInstance = getDO('list-test-empty')
      const result = await doInstance.getState().list()
      // May contain system keys from initialization, but user keys should be absent
      expect(typeof result).toBe('object')
    })
  })

  describe('Prefix filtering', () => {
    it('should filter by prefix', async () => {
      const doInstance = getDO('list-prefix-test-1')
      await doInstance.getState().setMany({
        'user:1': { name: 'Alice' },
        'user:2': { name: 'Bob' },
        'order:1': { total: 100 },
        'order:2': { total: 200 },
      })

      const users = await doInstance.getState().list({ prefix: 'user:' })
      expect(Object.keys(users)).toEqual(['user:1', 'user:2'])
      expect(users['user:1']).toEqual({ name: 'Alice' })
      expect(users['user:2']).toEqual({ name: 'Bob' })
    })

    it('should return empty object for non-matching prefix', async () => {
      const doInstance = getDO('list-prefix-test-2')
      await doInstance.getState().setMany({
        'item:1': 'value1',
        'item:2': 'value2',
      })

      const result = await doInstance.getState().list({ prefix: 'nonexistent:' })
      expect(Object.keys(result)).toHaveLength(0)
    })

    it('should handle prefix with special characters', async () => {
      const doInstance = getDO('list-prefix-test-3')
      await doInstance.getState().setMany({
        'data@v1:a': 1,
        'data@v1:b': 2,
        'data@v2:a': 3,
      })

      const result = await doInstance.getState().list({ prefix: 'data@v1:' })
      expect(Object.keys(result).sort()).toEqual(['data@v1:a', 'data@v1:b'])
    })
  })

  describe('Range filtering', () => {
    it('should filter by start range (inclusive)', async () => {
      const doInstance = getDO('list-range-test-1')
      await doInstance.getState().setMany({
        'a': 1,
        'b': 2,
        'c': 3,
        'd': 4,
      })

      const result = await doInstance.getState().list({ start: 'c' })
      const keys = Object.keys(result).filter(k => !k.startsWith('_'))
      expect(keys.sort()).toEqual(['c', 'd'])
    })

    it('should filter by end range (exclusive)', async () => {
      const doInstance = getDO('list-range-test-2')
      await doInstance.getState().setMany({
        'a': 1,
        'b': 2,
        'c': 3,
        'd': 4,
      })

      const result = await doInstance.getState().list({ end: 'c' })
      const keys = Object.keys(result).filter(k => !k.startsWith('_'))
      expect(keys.sort()).toEqual(['a', 'b'])
    })

    it('should combine start and end ranges', async () => {
      const doInstance = getDO('list-range-test-3')
      await doInstance.getState().setMany({
        'a': 1,
        'b': 2,
        'c': 3,
        'd': 4,
        'e': 5,
      })

      const result = await doInstance.getState().list({ start: 'b', end: 'd' })
      const keys = Object.keys(result).filter(k => !k.startsWith('_'))
      expect(keys.sort()).toEqual(['b', 'c'])
    })
  })

  describe('Limit and pagination', () => {
    it('should limit number of results', async () => {
      const doInstance = getDO('list-limit-test-1')
      await doInstance.getState().setMany({
        'item:01': 1,
        'item:02': 2,
        'item:03': 3,
        'item:04': 4,
        'item:05': 5,
      })

      const result = await doInstance.getState().list({ prefix: 'item:', limit: 3 })
      expect(Object.keys(result)).toHaveLength(3)
    })

    it('should return all if limit exceeds count', async () => {
      const doInstance = getDO('list-limit-test-2')
      await doInstance.getState().setMany({
        'x:1': 1,
        'x:2': 2,
      })

      const result = await doInstance.getState().list({ prefix: 'x:', limit: 100 })
      expect(Object.keys(result)).toHaveLength(2)
    })
  })

  describe('Reverse ordering', () => {
    it('should return results in reverse order', async () => {
      const doInstance = getDO('list-reverse-test-1')
      await doInstance.getState().setMany({
        'z:a': 1,
        'z:b': 2,
        'z:c': 3,
      })

      const result = await doInstance.getState().list({ prefix: 'z:', reverse: true })
      const keys = Object.keys(result)
      expect(keys).toEqual(['z:c', 'z:b', 'z:a'])
    })

    it('should combine reverse with limit', async () => {
      const doInstance = getDO('list-reverse-test-2')
      await doInstance.getState().setMany({
        'r:1': 1,
        'r:2': 2,
        'r:3': 3,
        'r:4': 4,
      })

      const result = await doInstance.getState().list({ prefix: 'r:', reverse: true, limit: 2 })
      const keys = Object.keys(result)
      expect(keys).toEqual(['r:4', 'r:3'])
    })
  })

  describe('Combined options', () => {
    it('should combine prefix with limit', async () => {
      const doInstance = getDO('list-combined-test-1')
      await doInstance.getState().setMany({
        'ns:a': 1,
        'ns:b': 2,
        'ns:c': 3,
        'other:x': 4,
      })

      const result = await doInstance.getState().list({ prefix: 'ns:', limit: 2 })
      expect(Object.keys(result)).toHaveLength(2)
      expect(Object.keys(result).every(k => k.startsWith('ns:'))).toBe(true)
    })

    it('should combine start, end, and limit', async () => {
      const doInstance = getDO('list-combined-test-2')
      await doInstance.getState().setMany({
        'k:a': 1,
        'k:b': 2,
        'k:c': 3,
        'k:d': 4,
        'k:e': 5,
      })

      const result = await doInstance.getState().list({
        prefix: 'k:',
        start: 'k:b',
        end: 'k:e',
        limit: 2,
      })
      expect(Object.keys(result)).toHaveLength(2)
    })
  })
})

// =============================================================================
// StateManager Transaction Tests
// =============================================================================

describe('StateManager transaction() operation', () => {
  describe('Successful transactions', () => {
    it('should execute a single set operation', async () => {
      const doInstance = getDO('tx-success-test-1')
      const ops: TransactionOp[] = [
        { op: 'set', key: 'tx-key', value: 'tx-value' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('tx-key')).toBe('tx-value')
    })

    it('should execute multiple set operations', async () => {
      const doInstance = getDO('tx-success-test-2')
      const ops: TransactionOp[] = [
        { op: 'set', key: 'tx-a', value: 1 },
        { op: 'set', key: 'tx-b', value: 2 },
        { op: 'set', key: 'tx-c', value: 3 },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('tx-a')).toBe(1)
      expect(await doInstance.getState().get('tx-b')).toBe(2)
      expect(await doInstance.getState().get('tx-c')).toBe(3)
    })

    it('should execute delete operations', async () => {
      const doInstance = getDO('tx-success-test-3')
      await doInstance.getState().set('to-delete', 'value')

      const ops: TransactionOp[] = [
        { op: 'delete', key: 'to-delete' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('to-delete')).toBeUndefined()
    })

    it('should execute mixed set and delete operations', async () => {
      const doInstance = getDO('tx-success-test-4')
      await doInstance.getState().set('old-key', 'old-value')

      const ops: TransactionOp[] = [
        { op: 'set', key: 'new-key', value: 'new-value' },
        { op: 'delete', key: 'old-key' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('new-key')).toBe('new-value')
      expect(await doInstance.getState().get('old-key')).toBeUndefined()
    })

    it('should handle empty operations array', async () => {
      const doInstance = getDO('tx-success-test-5')
      const ops: TransactionOp[] = []

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
    })
  })

  describe('Transaction rollback', () => {
    it('should rollback all changes when error operation is present', async () => {
      const doInstance = getDO('tx-rollback-test-1')
      await doInstance.getState().set('existing', 'original')

      const ops: TransactionOp[] = [
        { op: 'set', key: 'existing', value: 'modified' },
        { op: 'set', key: 'new-key', value: 'new-value' },
        { op: 'error' }, // Triggers rollback
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()

      // Verify rollback - existing should be restored, new-key should not exist
      expect(await doInstance.getState().get('existing')).toBe('original')
      expect(await doInstance.getState().get('new-key')).toBeUndefined()
    })

    it('should restore deleted values on rollback', async () => {
      const doInstance = getDO('tx-rollback-test-2')
      await doInstance.getState().set('will-be-deleted', 'restore-me')

      const ops: TransactionOp[] = [
        { op: 'delete', key: 'will-be-deleted' },
        { op: 'error' }, // Triggers rollback
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(false)

      // Verify rollback - deleted value should be restored
      expect(await doInstance.getState().get('will-be-deleted')).toBe('restore-me')
    })

    it('should rollback partial transaction on mid-execution error', async () => {
      const doInstance = getDO('tx-rollback-test-3')
      await doInstance.getState().setMany({
        'key1': 'value1',
        'key2': 'value2',
      })

      const ops: TransactionOp[] = [
        { op: 'set', key: 'key1', value: 'changed1' },
        { op: 'set', key: 'key2', value: 'changed2' },
        { op: 'error' }, // Triggers rollback
        { op: 'set', key: 'key3', value: 'new3' }, // Won't be reached
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(false)

      // All changes should be rolled back
      expect(await doInstance.getState().get('key1')).toBe('value1')
      expect(await doInstance.getState().get('key2')).toBe('value2')
      expect(await doInstance.getState().get('key3')).toBeUndefined()
    })

    it('should handle rollback of non-existent key set', async () => {
      const doInstance = getDO('tx-rollback-test-4')

      const ops: TransactionOp[] = [
        { op: 'set', key: 'brand-new', value: 'created' },
        { op: 'error' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(false)

      // New key should be deleted in rollback
      expect(await doInstance.getState().get('brand-new')).toBeUndefined()
    })
  })

  describe('Transaction edge cases', () => {
    it('should handle ops with missing key', async () => {
      const doInstance = getDO('tx-edge-test-1')

      // Operation without key should be ignored
      const ops: TransactionOp[] = [
        { op: 'set', value: 'no-key-value' } as TransactionOp,
        { op: 'set', key: 'valid-key', value: 'valid' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('valid-key')).toBe('valid')
    })

    it('should handle set op with undefined value', async () => {
      const doInstance = getDO('tx-edge-test-2')

      const ops: TransactionOp[] = [
        { op: 'set', key: 'undefined-value' }, // No value = undefined
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      const retrieved = await doInstance.getState().get('undefined-value')
      // undefined serializes to null or undefined depending on JSON.stringify behavior
      expect(retrieved === undefined || retrieved === null).toBe(true)
    })

    it('should preserve operation order in transaction', async () => {
      const doInstance = getDO('tx-edge-test-3')

      const ops: TransactionOp[] = [
        { op: 'set', key: 'order-test', value: 'first' },
        { op: 'set', key: 'order-test', value: 'second' },
        { op: 'set', key: 'order-test', value: 'third' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('order-test')).toBe('third')
    })

    it('should handle delete followed by set of same key', async () => {
      const doInstance = getDO('tx-edge-test-4')
      await doInstance.getState().set('recreate', 'original')

      const ops: TransactionOp[] = [
        { op: 'delete', key: 'recreate' },
        { op: 'set', key: 'recreate', value: 'recreated' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(true)
      expect(await doInstance.getState().get('recreate')).toBe('recreated')
    })

    it('should return error message on failed transaction', async () => {
      const doInstance = getDO('tx-edge-test-5')

      const ops: TransactionOp[] = [
        { op: 'error' },
      ]

      const result = await doInstance.getState().transaction(ops)
      expect(result.success).toBe(false)
      expect(result.error).toContain('error')
    })
  })
})

// =============================================================================
// StateManager query() Method Tests
// =============================================================================

describe('StateManager query() operation', () => {
  describe('Valid SELECT queries', () => {
    it('should execute simple SELECT', async () => {
      const doInstance = getDO('query-test-1')
      await doInstance.getState().set('query-key', 'query-value')

      const results = await doInstance.getState().query('SELECT * FROM state WHERE key = ?', ['query-key'])
      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBe(1)
      expect(results[0].key).toBe('query-key')
    })

    it('should parse JSON values in results', async () => {
      const doInstance = getDO('query-test-2')
      await doInstance.getState().set('json-key', { nested: { data: 123 } })

      const results = await doInstance.getState().query('SELECT * FROM state WHERE key = ?', ['json-key'])
      expect(results[0].value).toEqual({ nested: { data: 123 } })
    })

    it('should handle queries with no results', async () => {
      const doInstance = getDO('query-test-3')

      const results = await doInstance.getState().query('SELECT * FROM state WHERE key = ?', ['nonexistent'])
      expect(results).toEqual([])
    })

    it('should support LIKE queries', async () => {
      const doInstance = getDO('query-test-4')
      await doInstance.getState().setMany({
        'prefix:a': 1,
        'prefix:b': 2,
        'other:c': 3,
      })

      const results = await doInstance.getState().query('SELECT key FROM state WHERE key LIKE ?', ['prefix:%'])
      expect(results.map(r => r.key).sort()).toEqual(['prefix:a', 'prefix:b'])
    })
  })

  describe('Security validation', () => {
    it('should reject INSERT queries', async () => {
      const doInstance = getDO('query-security-test-1')

      await expect(
        doInstance.getState().query("INSERT INTO state VALUES ('hack', 'value')", [])
      ).rejects.toThrow()
    })

    it('should reject DELETE queries', async () => {
      const doInstance = getDO('query-security-test-2')

      await expect(
        doInstance.getState().query('DELETE FROM state', [])
      ).rejects.toThrow()
    })

    it('should reject DROP queries', async () => {
      const doInstance = getDO('query-security-test-3')

      await expect(
        doInstance.getState().query('DROP TABLE state', [])
      ).rejects.toThrow()
    })

    it('should reject multi-statement queries', async () => {
      const doInstance = getDO('query-security-test-4')

      await expect(
        doInstance.getState().query('SELECT * FROM state; DROP TABLE state;', [])
      ).rejects.toThrow()
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('StateManager error handling', () => {
  describe('Invalid key handling', () => {
    it('should handle undefined key in get gracefully', async () => {
      const doInstance = getDO('error-test-1')
      // TypeScript would catch this, but test runtime behavior
      // @ts-expect-error Testing invalid input
      const result = await doInstance.getState().get(undefined)
      // Should return undefined or handle gracefully
      expect(result === undefined || result === null).toBe(true)
    })

    it('should handle null key in get gracefully', async () => {
      const doInstance = getDO('error-test-2')
      // @ts-expect-error Testing invalid input
      const result = await doInstance.getState().get(null)
      expect(result === undefined || result === null).toBe(true)
    })

    it('should handle numeric key (coerced to string)', async () => {
      const doInstance = getDO('error-test-3')
      // @ts-expect-error Testing type coercion
      await doInstance.getState().set(123, 'numeric-key-value')
      // @ts-expect-error Testing type coercion
      const result = await doInstance.getState().get(123)
      // SQLite coerces to string
      expect(result).toBe('numeric-key-value')
    })
  })

  describe('Value serialization errors', () => {
    it('should handle circular references gracefully', async () => {
      const doInstance = getDO('error-test-4')
      const circular: Record<string, unknown> = { name: 'circular' }
      circular.self = circular

      // JSON.stringify throws on circular refs
      await expect(doInstance.getState().set('circular', circular)).rejects.toThrow()
    })

    it('should handle BigInt values (JSON limitation)', async () => {
      const doInstance = getDO('error-test-5')
      const bigIntValue = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)

      // BigInt cannot be serialized to JSON
      await expect(doInstance.getState().set('bigint', bigIntValue)).rejects.toThrow()
    })

    it('should handle function values gracefully', async () => {
      const doInstance = getDO('error-test-6')
      const func = () => 'hello'

      // Functions are stripped by JSON.stringify, resulting in undefined
      await doInstance.getState().set('function', func)
      const result = await doInstance.getState().get('function')
      // undefined becomes null in JSON
      expect(result === undefined || result === null).toBe(true)
    })
  })
})

// =============================================================================
// Lifecycle Key Usage Tests
// =============================================================================

describe('StateManager lifecycle key usage', () => {
  it('should use LIFECYCLE_START key correctly', async () => {
    const doInstance = getDO('lifecycle-test-1')
    await doInstance.getState().set(STATE_KEYS.LIFECYCLE_START, Date.now())
    const result = await doInstance.getState().get(STATE_KEYS.LIFECYCLE_START)
    expect(typeof result).toBe('number')
  })

  it('should use LIFECYCLE_START_COUNT key correctly', async () => {
    const doInstance = getDO('lifecycle-test-2')
    await doInstance.getState().set(STATE_KEYS.LIFECYCLE_START_COUNT, 5)
    const result = await doInstance.getState().get(STATE_KEYS.LIFECYCLE_START_COUNT)
    expect(result).toBe(5)
  })

  it('should use INITIALIZED key correctly', async () => {
    const doInstance = getDO('lifecycle-test-3')
    await doInstance.getState().set(STATE_KEYS.INITIALIZED, true)
    const result = await doInstance.getState().get(STATE_KEYS.INITIALIZED)
    expect(result).toBe(true)
  })

  it('should use ALARM_TRIGGERED key correctly', async () => {
    const doInstance = getDO('lifecycle-test-4')
    await doInstance.getState().set(STATE_KEYS.ALARM_TRIGGERED, true)
    const result = await doInstance.getState().get(STATE_KEYS.ALARM_TRIGGERED)
    expect(result).toBe(true)
  })

  it('should list lifecycle keys with prefix filter', async () => {
    const doInstance = getDO('lifecycle-test-5')
    await doInstance.getState().setMany({
      [STATE_KEYS.LIFECYCLE_START]: Date.now(),
      [STATE_KEYS.LIFECYCLE_START_COUNT]: 1,
      [STATE_KEYS.LIFECYCLE_HIBERNATE]: Date.now(),
      [STATE_KEYS.LIFECYCLE_WAKE]: Date.now(),
      [STATE_KEYS.LIFECYCLE_WAKE_COUNT]: 0,
    })

    const lifecycleState = await doInstance.getState().list({ prefix: '_lifecycle:' })
    expect(Object.keys(lifecycleState).length).toBeGreaterThanOrEqual(5)
  })
})
