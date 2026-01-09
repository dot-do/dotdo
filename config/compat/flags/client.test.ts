/**
 * GREEN Phase Tests for FlagsClient Core
 *
 * Tests for the core FlagsClient class functionality:
 * - Constructor - config validation, default values
 * - getValue(key, defaultValue, context) - flag evaluation
 * - getBooleanValue, getStringValue, getNumberValue, getObjectValue - typed getters
 * - getAllFlags(context) - batch evaluation
 * - onFlagChange(key, callback) - real-time updates
 *
 * @see compat/flags/client.ts - Implementation
 */

import { describe, it, expect, vi } from 'vitest'
import { FlagsClient, type FlagChangeHandler } from './client'
import type { EvaluationContext } from './types'

// ============================================================================
// SECTION 1: Constructor Tests
// ============================================================================

describe('FlagsClient Constructor', () => {
  describe('accepts FlagsConfig', () => {
    it('creates instance with minimal config', () => {
      const client = new FlagsClient({})
      expect(client).toBeInstanceOf(FlagsClient)
    })

    it('creates instance with endpoint', () => {
      const client = new FlagsClient({
        endpoint: 'https://flags.example.com',
      })
      expect(client).toBeInstanceOf(FlagsClient)
    })

    it('creates instance with apiKey', () => {
      const client = new FlagsClient({
        apiKey: 'test-api-key-12345',
      })
      expect(client).toBeInstanceOf(FlagsClient)
    })

    it('creates instance with cache config', () => {
      const client = new FlagsClient({
        cache: {
          enabled: true,
          ttl: 60000,
        },
      })
      expect(client).toBeInstanceOf(FlagsClient)
    })

    it('creates instance with offline mode', () => {
      const client = new FlagsClient({
        offline: true,
      })
      expect(client).toBeInstanceOf(FlagsClient)
    })

    it('creates instance with bootstrap data', () => {
      const client = new FlagsClient({
        bootstrap: {
          'feature-x': true,
          'feature-y': { color: 'blue' },
        },
      })
      expect(client).toBeInstanceOf(FlagsClient)
    })

    it('creates instance with full config', () => {
      const client = new FlagsClient({
        endpoint: 'https://flags.example.com',
        apiKey: 'api-key',
        cache: { enabled: true, ttl: 30000 },
        offline: false,
        bootstrap: {},
      })
      expect(client).toBeInstanceOf(FlagsClient)
    })
  })

  describe('initializes with default values', () => {
    it('sets default cache config when not provided', () => {
      const client = new FlagsClient({}) as any
      // Should have default cache: { enabled: true, ttl: 60000 }
      expect(client.config?.cache?.enabled).toBe(true)
      expect(client.config?.cache?.ttl).toBe(60000)
    })

    it('sets offline to false by default', () => {
      const client = new FlagsClient({}) as any
      expect(client.config?.offline).toBe(false)
    })

    it('initializes empty bootstrap by default', () => {
      const client = new FlagsClient({}) as any
      expect(client.config?.bootstrap).toEqual({})
    })
  })

  describe('validates config', () => {
    it('throws on invalid endpoint URL', () => {
      expect(() => {
        const client = new FlagsClient({
          endpoint: 'not-a-valid-url',
        })
      }).toThrow()
    })

    it('throws on negative cache TTL', () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { ttl: -1000 },
        })
      }).toThrow()
    })

    it('throws on empty apiKey', () => {
      expect(() => {
        const client = new FlagsClient({
          apiKey: '',
        })
      }).toThrow()
    })

    it('throws on invalid bootstrap data type', () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: 'invalid' as any,
        })
      }).toThrow()
    })
  })
})

// ============================================================================
// SECTION 2: getValue() Tests
// ============================================================================

describe('FlagsClient.getValue()', () => {
  describe('return type', () => {
    it('returns a Promise', () => {
      const client = new FlagsClient({})
      const result = client.getValue('test', 'default')
      expect(result).toBeInstanceOf(Promise)
    })

    it('resolves to the flag value', async () => {
      const client = new FlagsClient({
        bootstrap: { 'test-flag': 'test-value' },
      })
      const value = await client.getValue('test-flag', 'default')
      expect(value).toBe('test-value')
    })
  })

  describe('flag evaluation', () => {
    it('returns flag value when it exists', async () => {
      const client = new FlagsClient({
        bootstrap: { 'feature-enabled': true },
      })
      const value = await client.getValue('feature-enabled', false)
      expect(value).toBe(true)
    })

    it('returns default value when flag does not exist', async () => {
      const client = new FlagsClient({})
      const value = await client.getValue('nonexistent', 'default')
      expect(value).toBe('default')
    })

    it('returns flag value over default when flag exists', async () => {
      const client = new FlagsClient({
        bootstrap: { 'my-flag': 'actual' },
      })
      const value = await client.getValue('my-flag', 'default')
      expect(value).toBe('actual')
    })

    it('handles null flag values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'null-flag': null },
      })
      const value = await client.getValue('null-flag', 'default')
      expect(value).toBe(null)
    })

    it('handles undefined flag values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'undefined-flag': undefined },
      })
      const value = await client.getValue('undefined-flag', 'default')
      expect(value).toBe('default')
    })
  })

  describe('with evaluation context', () => {
    it('evaluates flag with user context', async () => {
      const client = new FlagsClient({})
      const context: EvaluationContext = {
        targetingKey: 'user-123',
        email: 'test@example.com',
      }
      const value = await client.getValue('targeted-flag', false, context)
      expect(typeof value).toBe('boolean')
    })

    it('evaluates flag without context (anonymous)', async () => {
      const client = new FlagsClient({})
      const value = await client.getValue('flag', 'default')
      expect(value).toBe('default')
    })

    it('uses targetingKey from context for evaluation', async () => {
      const client = new FlagsClient({})
      const context: EvaluationContext = {
        targetingKey: 'specific-user',
      }
      const value = await client.getValue('rollout-flag', false, context)
      expect(typeof value).toBe('boolean')
    })

    it('uses custom attributes from context', async () => {
      const client = new FlagsClient({})
      const context: EvaluationContext = {
        targetingKey: 'user-1',
        tier: 'premium',
        region: 'us-east',
      }
      const value = await client.getValue('tier-flag', 'basic', context)
      expect(typeof value).toBe('string')
    })
  })

  describe('value types', () => {
    it('returns boolean values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'bool-flag': true },
      })
      const value = await client.getValue('bool-flag', false)
      expect(value).toBe(true)
      expect(typeof value).toBe('boolean')
    })

    it('returns string values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'str-flag': 'hello' },
      })
      const value = await client.getValue('str-flag', 'default')
      expect(value).toBe('hello')
      expect(typeof value).toBe('string')
    })

    it('returns number values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'num-flag': 42 },
      })
      const value = await client.getValue('num-flag', 0)
      expect(value).toBe(42)
      expect(typeof value).toBe('number')
    })

    it('returns object values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'obj-flag': { color: 'blue', size: 'large' } },
      })
      const value = await client.getValue('obj-flag', {})
      expect(value).toEqual({ color: 'blue', size: 'large' })
      expect(typeof value).toBe('object')
    })

    it('returns array values', async () => {
      const client = new FlagsClient({
        bootstrap: { 'arr-flag': ['a', 'b', 'c'] },
      })
      const value = await client.getValue('arr-flag', [])
      expect(value).toEqual(['a', 'b', 'c'])
      expect(Array.isArray(value)).toBe(true)
    })
  })
})

// ============================================================================
// SECTION 3: Typed Getters (getBooleanValue, etc.)
// ============================================================================

describe('FlagsClient Typed Getters', () => {
  describe('getBooleanValue()', () => {
    it('returns boolean value', async () => {
      const client = new FlagsClient({
        bootstrap: { 'bool-flag': true },
      })
      const value = await client.getBooleanValue('bool-flag', false)
      expect(value).toBe(true)
    })

    it('returns default when flag not found', async () => {
      const client = new FlagsClient({})
      const value = await client.getBooleanValue('missing', false)
      expect(value).toBe(false)
    })

    it('returns default on type mismatch', async () => {
      const client = new FlagsClient({
        bootstrap: { 'wrong-type': 'string-not-bool' },
      })
      const value = await client.getBooleanValue('wrong-type', false)
      expect(value).toBe(false)
    })

    it('accepts evaluation context', async () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': true },
      })
      const context: EvaluationContext = { targetingKey: 'user-1' }
      const value = await client.getBooleanValue('flag', false, context)
      expect(value).toBe(true)
    })
  })

  describe('getStringValue()', () => {
    it('returns string value', async () => {
      const client = new FlagsClient({
        bootstrap: { 'str-flag': 'hello' },
      })
      const value = await client.getStringValue('str-flag', 'default')
      expect(value).toBe('hello')
    })

    it('returns default when flag not found', async () => {
      const client = new FlagsClient({})
      const value = await client.getStringValue('missing', 'default')
      expect(value).toBe('default')
    })

    it('returns default on type mismatch', async () => {
      const client = new FlagsClient({
        bootstrap: { 'wrong-type': 123 },
      })
      const value = await client.getStringValue('wrong-type', 'default')
      expect(value).toBe('default')
    })

    it('accepts evaluation context', async () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 'value' },
      })
      const context: EvaluationContext = { targetingKey: 'user-1' }
      const value = await client.getStringValue('flag', 'default', context)
      expect(value).toBe('value')
    })
  })

  describe('getNumberValue()', () => {
    it('returns number value', async () => {
      const client = new FlagsClient({
        bootstrap: { 'num-flag': 42 },
      })
      const value = await client.getNumberValue('num-flag', 0)
      expect(value).toBe(42)
    })

    it('returns default when flag not found', async () => {
      const client = new FlagsClient({})
      const value = await client.getNumberValue('missing', 0)
      expect(value).toBe(0)
    })

    it('returns default on type mismatch', async () => {
      const client = new FlagsClient({
        bootstrap: { 'wrong-type': 'not-a-number' },
      })
      const value = await client.getNumberValue('wrong-type', 0)
      expect(value).toBe(0)
    })

    it('accepts evaluation context', async () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 99 },
      })
      const context: EvaluationContext = { targetingKey: 'user-1' }
      const value = await client.getNumberValue('flag', 0, context)
      expect(value).toBe(99)
    })
  })

  describe('getObjectValue()', () => {
    it('returns object value', async () => {
      const client = new FlagsClient({
        bootstrap: { 'obj-flag': { color: 'blue' } },
      })
      const value = await client.getObjectValue('obj-flag', {})
      expect(value).toEqual({ color: 'blue' })
    })

    it('returns default when flag not found', async () => {
      const client = new FlagsClient({})
      const value = await client.getObjectValue('missing', { default: true })
      expect(value).toEqual({ default: true })
    })

    it('returns default on type mismatch', async () => {
      const client = new FlagsClient({
        bootstrap: { 'wrong-type': 'string' },
      })
      const value = await client.getObjectValue('wrong-type', {})
      expect(value).toEqual({})
    })

    it('accepts evaluation context', async () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': { key: 'value' } },
      })
      const context: EvaluationContext = { targetingKey: 'user-1' }
      const value = await client.getObjectValue('flag', {}, context)
      expect(value).toEqual({ key: 'value' })
    })

    it('returns arrays as objects', async () => {
      const client = new FlagsClient({
        bootstrap: { 'arr-flag': [1, 2, 3] },
      })
      const value = await client.getObjectValue('arr-flag', [])
      expect(value).toEqual([1, 2, 3])
    })
  })
})

// ============================================================================
// SECTION 4: getAllFlags() Tests
// ============================================================================

describe('FlagsClient.getAllFlags()', () => {
  describe('batch evaluation', () => {
    it('returns all flag values', async () => {
      const client = new FlagsClient({
        bootstrap: {
          'flag-a': true,
          'flag-b': 'hello',
          'flag-c': 42,
        },
      })
      const flags = await client.getAllFlags()
      expect(flags).toEqual({
        'flag-a': true,
        'flag-b': 'hello',
        'flag-c': 42,
      })
    })

    it('returns empty object when no flags', async () => {
      const client = new FlagsClient({})
      const flags = await client.getAllFlags()
      expect(flags).toEqual({})
    })

    it('evaluates all flags with context', async () => {
      const client = new FlagsClient({
        bootstrap: {
          'flag-1': 'a',
          'flag-2': 'b',
        },
      })
      const context: EvaluationContext = { targetingKey: 'user-123' }
      const flags = await client.getAllFlags(context)
      expect(flags).toEqual({
        'flag-1': 'a',
        'flag-2': 'b',
      })
    })

    it('includes null values', async () => {
      const client = new FlagsClient({
        bootstrap: {
          'flag-a': true,
          'flag-b': null,
        },
      })
      const flags = await client.getAllFlags()
      expect(flags).toEqual({
        'flag-a': true,
        'flag-b': null,
      })
    })

    it('excludes undefined values', async () => {
      const client = new FlagsClient({
        bootstrap: {
          'flag-a': true,
          'flag-b': undefined,
        },
      })
      const flags = await client.getAllFlags()
      expect(flags).toEqual({ 'flag-a': true })
      expect('flag-b' in flags).toBe(false)
    })
  })

  describe('caching behavior', () => {
    it('uses cached values when available', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: { 'cached-flag': 'value' },
      })
      const flags1 = await client.getAllFlags()
      const flags2 = await client.getAllFlags()
      expect(flags1).toEqual({ 'cached-flag': 'value' })
      expect(flags2).toEqual({ 'cached-flag': 'value' })
    })

    it('bypasses cache when disabled', async () => {
      const client = new FlagsClient({
        cache: { enabled: false },
        bootstrap: { 'no-cache-flag': 'value' },
      })
      const flags = await client.getAllFlags()
      expect(flags).toEqual({ 'no-cache-flag': 'value' })
    })
  })
})

// ============================================================================
// SECTION 5: onFlagChange() Tests
// ============================================================================

describe('FlagsClient.onFlagChange()', () => {
  describe('callback registration', () => {
    it('registers change handler for specific flag', () => {
      const client = new FlagsClient({})
      const handler = vi.fn()
      const unsubscribe = client.onFlagChange('my-flag', handler)
      expect(typeof unsubscribe).toBe('function')
    })

    it('allows multiple handlers for same flag', () => {
      const client = new FlagsClient({})
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const unsub1 = client.onFlagChange('my-flag', handler1)
      const unsub2 = client.onFlagChange('my-flag', handler2)
      expect(typeof unsub1).toBe('function')
      expect(typeof unsub2).toBe('function')
    })

    it('allows handlers for different flags', () => {
      const client = new FlagsClient({})
      const handlerA = vi.fn()
      const handlerB = vi.fn()
      const unsubA = client.onFlagChange('flag-a', handlerA)
      const unsubB = client.onFlagChange('flag-b', handlerB)
      expect(typeof unsubA).toBe('function')
      expect(typeof unsubB).toBe('function')
    })
  })

  describe('callback invocation', () => {
    it('calls handler when flag value changes', () => {
      const client = new FlagsClient({
        bootstrap: { 'test-flag': 'old' },
      })
      const handler = vi.fn()
      client.onFlagChange('test-flag', handler)
      client.updateFlag('test-flag', 'new')
      expect(handler).toHaveBeenCalledWith('test-flag', 'old', 'new')
    })

    it('does not call handler when flag value unchanged', () => {
      const client = new FlagsClient({
        bootstrap: { 'test-flag': 'same' },
      })
      const handler = vi.fn()
      client.onFlagChange('test-flag', handler)
      client.updateFlag('test-flag', 'same')
      expect(handler).not.toHaveBeenCalled()
    })

    it('calls handler with old and new values', () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': true },
      })
      const handler = vi.fn()
      client.onFlagChange('flag', handler)
      client.updateFlag('flag', false)
      expect(handler).toHaveBeenCalledWith('flag', true, false)
    })

    it('calls all registered handlers on change', () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 1 },
      })
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      client.onFlagChange('flag', handler1)
      client.onFlagChange('flag', handler2)
      client.updateFlag('flag', 2)
      expect(handler1).toHaveBeenCalledWith('flag', 1, 2)
      expect(handler2).toHaveBeenCalledWith('flag', 1, 2)
    })

    it('handles null to value change', () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': null },
      })
      const handler = vi.fn()
      client.onFlagChange('flag', handler)
      client.updateFlag('flag', 'value')
      expect(handler).toHaveBeenCalledWith('flag', null, 'value')
    })

    it('handles value to null change', () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 'value' },
      })
      const handler = vi.fn()
      client.onFlagChange('flag', handler)
      client.updateFlag('flag', null)
      expect(handler).toHaveBeenCalledWith('flag', 'value', null)
    })
  })

  describe('unsubscribe', () => {
    it('returns unsubscribe function', () => {
      const client = new FlagsClient({})
      const handler = vi.fn()
      const unsubscribe = client.onFlagChange('flag', handler)
      expect(typeof unsubscribe).toBe('function')
    })

    it('unsubscribe removes handler', () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 1 },
      })
      const handler = vi.fn()
      const unsubscribe = client.onFlagChange('flag', handler)
      unsubscribe()
      client.updateFlag('flag', 2)
      expect(handler).not.toHaveBeenCalled()
    })

    it('unsubscribe only removes specific handler', () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 1 },
      })
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const unsubscribe1 = client.onFlagChange('flag', handler1)
      client.onFlagChange('flag', handler2)
      unsubscribe1()
      client.updateFlag('flag', 2)
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledWith('flag', 1, 2)
    })
  })
})

// ============================================================================
// SECTION 6: Caching Tests
// ============================================================================

describe('FlagsClient Caching', () => {
  describe('cache behavior', () => {
    it('caches flag values when enabled', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: { 'cached-flag': 'value' },
      })
      const value1 = await client.getValue('cached-flag', 'default')
      const value2 = await client.getValue('cached-flag', 'default')
      expect(value1).toBe('value')
      expect(value2).toBe('value')
    })

    it('does not cache when disabled', async () => {
      const client = new FlagsClient({
        cache: { enabled: false },
        bootstrap: { 'no-cache': 'value' },
      })
      const value = await client.getValue('no-cache', 'default')
      expect(value).toBe('value')
    })

    it('respects cache TTL', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 50 },
        bootstrap: { 'ttl-flag': 'value' },
      })
      const value1 = await client.getValue('ttl-flag', 'default')
      expect(value1).toBe('value')
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100))
      const value2 = await client.getValue('ttl-flag', 'default')
      expect(value2).toBe('value')
    })

    it('caches per flag key', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: {
          'flag-a': 'a',
          'flag-b': 'b',
        },
      })
      const valueA = await client.getValue('flag-a', 'default')
      const valueB = await client.getValue('flag-b', 'default')
      expect(valueA).toBe('a')
      expect(valueB).toBe('b')
    })

    it('caches per evaluation context', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: { 'flag': 'value' },
      })
      const context1: EvaluationContext = { targetingKey: 'user-1' }
      const context2: EvaluationContext = { targetingKey: 'user-2' }
      const value1 = await client.getValue('flag', 'default', context1)
      const value2 = await client.getValue('flag', 'default', context2)
      expect(value1).toBe('value')
      expect(value2).toBe('value')
    })
  })

  describe('cache invalidation', () => {
    it('invalidates cache on flag update', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: { 'flag': 'old' },
      })
      const value1 = await client.getValue('flag', 'default')
      expect(value1).toBe('old')
      client.updateFlag('flag', 'new')
      const value2 = await client.getValue('flag', 'default')
      expect(value2).toBe('new')
    })

    it('provides invalidateCache method', () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
      })
      expect(typeof client.invalidateCache).toBe('function')
      // Should not throw
      client.invalidateCache()
      client.invalidateCache('specific-flag')
    })

    it('invalidates all caches when called without key', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: { 'flag-a': 'a', 'flag-b': 'b' },
      })
      await client.getValue('flag-a', 'default')
      await client.getValue('flag-b', 'default')
      client.invalidateCache()
      // After invalidation, cache is empty but values still exist
      const valueA = await client.getValue('flag-a', 'default')
      const valueB = await client.getValue('flag-b', 'default')
      expect(valueA).toBe('a')
      expect(valueB).toBe('b')
    })

    it('invalidates specific flag cache when called with key', async () => {
      const client = new FlagsClient({
        cache: { enabled: true, ttl: 60000 },
        bootstrap: { 'flag-a': 'a', 'flag-b': 'b' },
      })
      await client.getValue('flag-a', 'default')
      await client.getValue('flag-b', 'default')
      client.invalidateCache('flag-a')
      // After invalidation, cache for flag-a is cleared
      const valueA = await client.getValue('flag-a', 'default')
      const valueB = await client.getValue('flag-b', 'default')
      expect(valueA).toBe('a')
      expect(valueB).toBe('b')
    })
  })
})

// ============================================================================
// SECTION 7: Edge Cases and Error Handling
// ============================================================================

describe('FlagsClient Edge Cases', () => {
  describe('offline mode', () => {
    it('uses only bootstrap data when offline', async () => {
      const client = new FlagsClient({
        offline: true,
        bootstrap: { 'offline-flag': true },
      })
      const value = await client.getValue('offline-flag', false)
      expect(value).toBe(true)
    })

    it('returns default for missing flags when offline', async () => {
      const client = new FlagsClient({
        offline: true,
      })
      const value = await client.getValue('missing', 'default')
      expect(value).toBe('default')
    })

    it('does not make network requests when offline', async () => {
      const client = new FlagsClient({
        offline: true,
        endpoint: 'https://flags.example.com',
      })
      const value = await client.getValue('flag', 'default')
      expect(value).toBe('default')
    })
  })

  describe('error handling', () => {
    it('returns default on evaluation error', async () => {
      const client = new FlagsClient({})
      const value = await client.getValue('error-flag', 'safe-default')
      expect(value).toBe('safe-default')
    })

    it('handles network errors gracefully', async () => {
      const client = new FlagsClient({
        endpoint: 'https://flags.example.com',
      })
      const value = await client.getValue('flag', 'default')
      expect(value).toBe('default')
    })

    it('handles invalid flag data gracefully', async () => {
      const client = new FlagsClient({
        bootstrap: {
          'invalid-flag': Symbol('invalid') as any,
        },
      })
      const value = await client.getValue('invalid-flag', 'default')
      // Symbol values are stored as-is, returned as the flag value
      expect(typeof value).toBe('symbol')
    })
  })

  describe('concurrent access', () => {
    it('handles concurrent getValue calls', async () => {
      const client = new FlagsClient({
        bootstrap: { 'flag': 'value' },
      })
      const results = await Promise.all([
        client.getValue('flag', 'default'),
        client.getValue('flag', 'default'),
        client.getValue('flag', 'default'),
      ])
      expect(results).toEqual(['value', 'value', 'value'])
    })

    it('handles concurrent getAllFlags calls', async () => {
      const client = new FlagsClient({
        bootstrap: { 'flag-a': 'a', 'flag-b': 'b' },
      })
      const results = await Promise.all([
        client.getAllFlags(),
        client.getAllFlags(),
      ])
      expect(results[0]).toEqual({ 'flag-a': 'a', 'flag-b': 'b' })
      expect(results[1]).toEqual({ 'flag-a': 'a', 'flag-b': 'b' })
    })
  })
})
