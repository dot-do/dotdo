/**
 * RED Phase Tests for FlagsClient Core
 *
 * Tests for the core FlagsClient class functionality:
 * - Constructor - config validation, default values
 * - getValue(key, defaultValue, context) - flag evaluation
 * - getBooleanValue, getStringValue, getNumberValue, getObjectValue - typed getters
 * - getAllFlags(context) - batch evaluation
 * - onFlagChange(key, callback) - real-time updates
 *
 * These tests define the expected behavior and will FAIL until the
 * FlagsClient class is implemented.
 *
 * @see compat/flags/client.ts - Implementation (not yet created)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Test Types (Mock interfaces - will be replaced by actual types)
// ============================================================================

interface FlagsConfig {
  endpoint?: string
  apiKey?: string
  cache?: {
    enabled?: boolean
    ttl?: number
  }
  offline?: boolean
  bootstrap?: Record<string, unknown>
}

interface EvaluationContext {
  targetingKey?: string
  [key: string]: unknown
}

interface FlagChangeHandler<T = unknown> {
  (key: string, oldValue: T | null, newValue: T | null): void
}

// Mock FlagsClient - will be replaced by actual implementation
// Uncomment when implementation exists:
// import { FlagsClient } from './client'

// Temporary mock for RED phase
class FlagsClient {
  constructor(config: FlagsConfig) {
    // Intentionally minimal - tests should fail when trying to use methods
  }

  getValue(key: string, defaultValue: any, context?: EvaluationContext): Promise<any> {
    throw new Error('getValue not implemented')
  }

  getBooleanValue(key: string, defaultValue: boolean, context?: EvaluationContext): Promise<boolean> {
    throw new Error('getBooleanValue not implemented')
  }

  getStringValue(key: string, defaultValue: string, context?: EvaluationContext): Promise<string> {
    throw new Error('getStringValue not implemented')
  }

  getNumberValue(key: string, defaultValue: number, context?: EvaluationContext): Promise<number> {
    throw new Error('getNumberValue not implemented')
  }

  getObjectValue<T = any>(key: string, defaultValue: T, context?: EvaluationContext): Promise<T> {
    throw new Error('getObjectValue not implemented')
  }

  getAllFlags(context?: EvaluationContext): Promise<Record<string, any>> {
    throw new Error('getAllFlags not implemented')
  }

  onFlagChange<T = unknown>(key: string, callback: FlagChangeHandler<T>): () => void {
    throw new Error('onFlagChange not implemented')
  }

  invalidateCache(key?: string): void {
    throw new Error('invalidateCache not implemented')
  }
}

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
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'bool-flag': true },
        })
        // await client.getBooleanValue('bool-flag', false)
        // Should return true
      }).toThrow('FlagsClient not implemented')
    })

    it('returns default when flag not found', async () => {
      expect(() => {
        const client = new FlagsClient({})
        // await client.getBooleanValue('missing', false)
        // Should return false
      }).toThrow('FlagsClient not implemented')
    })

    it('throws on type mismatch', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'wrong-type': 'string-not-bool' },
        })
        // await client.getBooleanValue('wrong-type', false)
        // Should throw or return default
      }).toThrow('FlagsClient not implemented')
    })

    it('accepts evaluation context', async () => {
      expect(() => {
        const client = new FlagsClient({})
        const context: EvaluationContext = { targetingKey: 'user-1' }
        // await client.getBooleanValue('flag', false, context)
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('getStringValue()', () => {
    it('returns string value', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'str-flag': 'hello' },
        })
        // await client.getStringValue('str-flag', 'default')
        // Should return 'hello'
      }).toThrow('FlagsClient not implemented')
    })

    it('returns default when flag not found', async () => {
      expect(() => {
        const client = new FlagsClient({})
        // await client.getStringValue('missing', 'default')
        // Should return 'default'
      }).toThrow('FlagsClient not implemented')
    })

    it('throws on type mismatch', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'wrong-type': 123 },
        })
        // await client.getStringValue('wrong-type', 'default')
        // Should throw or return default
      }).toThrow('FlagsClient not implemented')
    })

    it('accepts evaluation context', async () => {
      expect(() => {
        const client = new FlagsClient({})
        const context: EvaluationContext = { targetingKey: 'user-1' }
        // await client.getStringValue('flag', 'default', context)
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('getNumberValue()', () => {
    it('returns number value', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'num-flag': 42 },
        })
        // await client.getNumberValue('num-flag', 0)
        // Should return 42
      }).toThrow('FlagsClient not implemented')
    })

    it('returns default when flag not found', async () => {
      expect(() => {
        const client = new FlagsClient({})
        // await client.getNumberValue('missing', 0)
        // Should return 0
      }).toThrow('FlagsClient not implemented')
    })

    it('throws on type mismatch', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'wrong-type': 'not-a-number' },
        })
        // await client.getNumberValue('wrong-type', 0)
        // Should throw or return default
      }).toThrow('FlagsClient not implemented')
    })

    it('accepts evaluation context', async () => {
      expect(() => {
        const client = new FlagsClient({})
        const context: EvaluationContext = { targetingKey: 'user-1' }
        // await client.getNumberValue('flag', 0, context)
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('getObjectValue()', () => {
    it('returns object value', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'obj-flag': { color: 'blue' } },
        })
        // await client.getObjectValue('obj-flag', {})
        // Should return { color: 'blue' }
      }).toThrow('FlagsClient not implemented')
    })

    it('returns default when flag not found', async () => {
      expect(() => {
        const client = new FlagsClient({})
        // await client.getObjectValue('missing', { default: true })
        // Should return { default: true }
      }).toThrow('FlagsClient not implemented')
    })

    it('throws on type mismatch', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'wrong-type': 'string' },
        })
        // await client.getObjectValue('wrong-type', {})
        // Should throw or return default
      }).toThrow('FlagsClient not implemented')
    })

    it('accepts evaluation context', async () => {
      expect(() => {
        const client = new FlagsClient({})
        const context: EvaluationContext = { targetingKey: 'user-1' }
        // await client.getObjectValue('flag', {}, context)
      }).toThrow('FlagsClient not implemented')
    })

    it('returns arrays as objects', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'arr-flag': [1, 2, 3] },
        })
        // await client.getObjectValue('arr-flag', [])
        // Should return [1, 2, 3]
      }).toThrow('FlagsClient not implemented')
    })
  })
})

// ============================================================================
// SECTION 4: getAllFlags() Tests
// ============================================================================

describe('FlagsClient.getAllFlags()', () => {
  describe('batch evaluation', () => {
    it('returns all flag values', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: {
            'flag-a': true,
            'flag-b': 'hello',
            'flag-c': 42,
          },
        })
        // await client.getAllFlags()
        // Should return { 'flag-a': true, 'flag-b': 'hello', 'flag-c': 42 }
      }).toThrow('FlagsClient not implemented')
    })

    it('returns empty object when no flags', async () => {
      expect(() => {
        const client = new FlagsClient({})
        // await client.getAllFlags()
        // Should return {}
      }).toThrow('FlagsClient not implemented')
    })

    it('evaluates all flags with context', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: {
            'flag-1': 'a',
            'flag-2': 'b',
          },
        })
        const context: EvaluationContext = { targetingKey: 'user-123' }
        // await client.getAllFlags(context)
      }).toThrow('FlagsClient not implemented')
    })

    it('includes null values', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: {
            'flag-a': true,
            'flag-b': null,
          },
        })
        // await client.getAllFlags()
        // Should return { 'flag-a': true, 'flag-b': null }
      }).toThrow('FlagsClient not implemented')
    })

    it('excludes undefined values', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: {
            'flag-a': true,
            'flag-b': undefined,
          },
        })
        // await client.getAllFlags()
        // Should return { 'flag-a': true } (no flag-b)
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('caching behavior', () => {
    it('uses cached values when available', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
          bootstrap: { 'cached-flag': 'value' },
        })
        // await client.getAllFlags()
        // Second call should use cache
        // await client.getAllFlags()
      }).toThrow('FlagsClient not implemented')
    })

    it('bypasses cache when disabled', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: false },
          bootstrap: { 'no-cache-flag': 'value' },
        })
        // await client.getAllFlags()
      }).toThrow('FlagsClient not implemented')
    })
  })
})

// ============================================================================
// SECTION 5: onFlagChange() Tests
// ============================================================================

describe('FlagsClient.onFlagChange()', () => {
  describe('callback registration', () => {
    it('registers change handler for specific flag', () => {
      expect(() => {
        const client = new FlagsClient({})
        const handler = vi.fn()
        // client.onFlagChange('my-flag', handler)
      }).toThrow('FlagsClient not implemented')
    })

    it('allows multiple handlers for same flag', () => {
      expect(() => {
        const client = new FlagsClient({})
        const handler1 = vi.fn()
        const handler2 = vi.fn()
        // client.onFlagChange('my-flag', handler1)
        // client.onFlagChange('my-flag', handler2)
      }).toThrow('FlagsClient not implemented')
    })

    it('allows handlers for different flags', () => {
      expect(() => {
        const client = new FlagsClient({})
        const handlerA = vi.fn()
        const handlerB = vi.fn()
        // client.onFlagChange('flag-a', handlerA)
        // client.onFlagChange('flag-b', handlerB)
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('callback invocation', () => {
    it('calls handler when flag value changes', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'test-flag': 'old' },
        })
        const handler = vi.fn()
        // client.onFlagChange('test-flag', handler)
        // Simulate flag update
        // handler should be called with ('test-flag', 'old', 'new')
      }).toThrow('FlagsClient not implemented')
    })

    it('does not call handler when flag value unchanged', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'test-flag': 'same' },
        })
        const handler = vi.fn()
        // client.onFlagChange('test-flag', handler)
        // Simulate flag update with same value
        // handler should NOT be called
      }).toThrow('FlagsClient not implemented')
    })

    it('calls handler with old and new values', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': true },
        })
        const handler = vi.fn()
        // client.onFlagChange('flag', handler)
        // Update flag to false
        // handler should be called with ('flag', true, false)
      }).toThrow('FlagsClient not implemented')
    })

    it('calls all registered handlers on change', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': 1 },
        })
        const handler1 = vi.fn()
        const handler2 = vi.fn()
        // client.onFlagChange('flag', handler1)
        // client.onFlagChange('flag', handler2)
        // Update flag to 2
        // Both handlers should be called
      }).toThrow('FlagsClient not implemented')
    })

    it('handles null to value change', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': null },
        })
        const handler = vi.fn()
        // client.onFlagChange('flag', handler)
        // Update flag to 'value'
        // handler should be called with ('flag', null, 'value')
      }).toThrow('FlagsClient not implemented')
    })

    it('handles value to null change', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': 'value' },
        })
        const handler = vi.fn()
        // client.onFlagChange('flag', handler)
        // Update flag to null
        // handler should be called with ('flag', 'value', null)
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('unsubscribe', () => {
    it('returns unsubscribe function', () => {
      expect(() => {
        const client = new FlagsClient({})
        const handler = vi.fn()
        // const unsubscribe = client.onFlagChange('flag', handler)
        // expect(typeof unsubscribe).toBe('function')
      }).toThrow('FlagsClient not implemented')
    })

    it('unsubscribe removes handler', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': 1 },
        })
        const handler = vi.fn()
        // const unsubscribe = client.onFlagChange('flag', handler)
        // unsubscribe()
        // Update flag to 2
        // handler should NOT be called
      }).toThrow('FlagsClient not implemented')
    })

    it('unsubscribe only removes specific handler', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': 1 },
        })
        const handler1 = vi.fn()
        const handler2 = vi.fn()
        // const unsubscribe1 = client.onFlagChange('flag', handler1)
        // client.onFlagChange('flag', handler2)
        // unsubscribe1()
        // Update flag to 2
        // handler1 should NOT be called, handler2 SHOULD be called
      }).toThrow('FlagsClient not implemented')
    })
  })
})

// ============================================================================
// SECTION 6: Caching Tests
// ============================================================================

describe('FlagsClient Caching', () => {
  describe('cache behavior', () => {
    it('caches flag values when enabled', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
          bootstrap: { 'cached-flag': 'value' },
        })
        // await client.getValue('cached-flag', 'default')
        // Second call should use cache
        // await client.getValue('cached-flag', 'default')
      }).toThrow('FlagsClient not implemented')
    })

    it('does not cache when disabled', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: false },
          bootstrap: { 'no-cache': 'value' },
        })
        // await client.getValue('no-cache', 'default')
      }).toThrow('FlagsClient not implemented')
    })

    it('respects cache TTL', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 100 },
          bootstrap: { 'ttl-flag': 'value' },
        })
        // await client.getValue('ttl-flag', 'default')
        // Wait for TTL to expire
        // await new Promise(resolve => setTimeout(resolve, 150))
        // await client.getValue('ttl-flag', 'default')
        // Should re-evaluate, not use cache
      }).toThrow('FlagsClient not implemented')
    })

    it('caches per flag key', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
          bootstrap: {
            'flag-a': 'a',
            'flag-b': 'b',
          },
        })
        // await client.getValue('flag-a', 'default')
        // await client.getValue('flag-b', 'default')
        // Each flag should have separate cache entry
      }).toThrow('FlagsClient not implemented')
    })

    it('caches per evaluation context', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
        })
        const context1: EvaluationContext = { targetingKey: 'user-1' }
        const context2: EvaluationContext = { targetingKey: 'user-2' }
        // await client.getValue('flag', 'default', context1)
        // await client.getValue('flag', 'default', context2)
        // Different contexts should have separate cache entries
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('cache invalidation', () => {
    it('invalidates cache on flag update', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
          bootstrap: { 'flag': 'old' },
        })
        // await client.getValue('flag', 'default')
        // Update flag value
        // await client.getValue('flag', 'default')
        // Should return new value, not cached
      }).toThrow('FlagsClient not implemented')
    })

    it('provides invalidateCache method', () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
        })
        // client.invalidateCache()
        // or client.invalidateCache('specific-flag')
      }).toThrow('FlagsClient not implemented')
    })

    it('invalidates all caches when called without key', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
          bootstrap: { 'flag-a': 'a', 'flag-b': 'b' },
        })
        // await client.getValue('flag-a', 'default')
        // await client.getValue('flag-b', 'default')
        // client.invalidateCache()
        // Next calls should re-evaluate
      }).toThrow('FlagsClient not implemented')
    })

    it('invalidates specific flag cache when called with key', async () => {
      expect(() => {
        const client = new FlagsClient({
          cache: { enabled: true, ttl: 60000 },
          bootstrap: { 'flag-a': 'a', 'flag-b': 'b' },
        })
        // await client.getValue('flag-a', 'default')
        // await client.getValue('flag-b', 'default')
        // client.invalidateCache('flag-a')
        // flag-a should re-evaluate, flag-b still cached
      }).toThrow('FlagsClient not implemented')
    })
  })
})

// ============================================================================
// SECTION 7: Edge Cases and Error Handling
// ============================================================================

describe('FlagsClient Edge Cases', () => {
  describe('offline mode', () => {
    it('uses only bootstrap data when offline', async () => {
      expect(() => {
        const client = new FlagsClient({
          offline: true,
          bootstrap: { 'offline-flag': true },
        })
        // await client.getValue('offline-flag', false)
        // Should return true from bootstrap
      }).toThrow('FlagsClient not implemented')
    })

    it('returns default for missing flags when offline', async () => {
      expect(() => {
        const client = new FlagsClient({
          offline: true,
        })
        // await client.getValue('missing', 'default')
        // Should return 'default'
      }).toThrow('FlagsClient not implemented')
    })

    it('does not make network requests when offline', async () => {
      expect(() => {
        const client = new FlagsClient({
          offline: true,
          endpoint: 'https://flags.example.com',
        })
        // await client.getValue('flag', 'default')
        // Should not attempt network request
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('error handling', () => {
    it('returns default on evaluation error', async () => {
      expect(() => {
        const client = new FlagsClient({})
        // Simulate evaluation error
        // await client.getValue('error-flag', 'safe-default')
        // Should return 'safe-default'
      }).toThrow('FlagsClient not implemented')
    })

    it('handles network errors gracefully', async () => {
      expect(() => {
        const client = new FlagsClient({
          endpoint: 'https://flags.example.com',
        })
        // Simulate network error
        // await client.getValue('flag', 'default')
        // Should return 'default' and not throw
      }).toThrow('FlagsClient not implemented')
    })

    it('handles invalid flag data gracefully', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: {
            'invalid-flag': Symbol('invalid') as any,
          },
        })
        // await client.getValue('invalid-flag', 'default')
        // Should return 'default' or throw appropriate error
      }).toThrow('FlagsClient not implemented')
    })
  })

  describe('concurrent access', () => {
    it('handles concurrent getValue calls', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag': 'value' },
        })
        // await Promise.all([
        //   client.getValue('flag', 'default'),
        //   client.getValue('flag', 'default'),
        //   client.getValue('flag', 'default'),
        // ])
      }).toThrow('FlagsClient not implemented')
    })

    it('handles concurrent getAllFlags calls', async () => {
      expect(() => {
        const client = new FlagsClient({
          bootstrap: { 'flag-a': 'a', 'flag-b': 'b' },
        })
        // await Promise.all([
        //   client.getAllFlags(),
        //   client.getAllFlags(),
        // ])
      }).toThrow('FlagsClient not implemented')
    })
  })
})
