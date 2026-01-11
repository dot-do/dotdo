/**
 * Property Operations Tests
 *
 * TDD RED Phase: These tests define the expected behavior
 * for Amplitude/PostHog-style property operations.
 *
 * Property operations allow incremental updates to user/event properties
 * without requiring a full property replacement.
 *
 * Test Coverage:
 * - $set: Set property value (overwrites existing)
 * - $setOnce: Set property only if not already set
 * - $add: Increment numeric property
 * - $append: Append to array property
 * - $prepend: Prepend to array property
 * - $unset: Remove property entirely
 * - $remove: Remove value from array property
 *
 * @module @dotdo/compat/analytics/property-ops.test
 */
import { describe, it, expect } from 'vitest'
import {
  applyPropertyOperations,
  type PropertyOperations,
  // Convenience helpers
  propertyOps,
  PropertyOpsBuilder,
  setProperty,
  setPropertyOnce,
  incrementProperty,
  decrementProperty,
  appendProperty,
  prependProperty,
  unsetProperty,
  removeFromProperty,
  // Batch operations
  batchApplyOperations,
  batchApplyDifferentOperations,
  // User property manager
  userProperties,
  UserPropertyManager,
  // Utilities
  mergeOperations,
  isEmptyOperations,
} from './property-ops'

// ============================================================================
// $set OPERATION TESTS
// ============================================================================

describe('$set operation', () => {
  it('should set a new property', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $set: { name: 'John' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
  })

  it('should overwrite an existing property', () => {
    const properties = { name: 'Jane' }
    const operations: PropertyOperations = {
      $set: { name: 'John' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
  })

  it('should set multiple properties at once', () => {
    const properties = { existing: true }
    const operations: PropertyOperations = {
      $set: {
        name: 'John',
        email: 'john@example.com.ai',
        age: 30,
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
    expect(result.email).toBe('john@example.com.ai')
    expect(result.age).toBe(30)
    expect(result.existing).toBe(true)
  })

  it('should set nested object properties', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $set: {
        address: {
          city: 'San Francisco',
          state: 'CA',
        },
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.address).toEqual({ city: 'San Francisco', state: 'CA' })
  })

  it('should set array properties', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $set: {
        tags: ['vip', 'enterprise'],
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['vip', 'enterprise'])
  })

  it('should set null and undefined values', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $set: {
        name: null,
        title: undefined,
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBeNull()
    expect(result.title).toBeUndefined()
  })
})

// ============================================================================
// $setOnce OPERATION TESTS
// ============================================================================

describe('$setOnce operation', () => {
  it('should set a property if it does not exist', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $setOnce: { firstSeen: '2024-01-15' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.firstSeen).toBe('2024-01-15')
  })

  it('should NOT overwrite an existing property', () => {
    const properties = { firstSeen: '2024-01-01' }
    const operations: PropertyOperations = {
      $setOnce: { firstSeen: '2024-01-15' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.firstSeen).toBe('2024-01-01')
  })

  it('should set multiple properties, only where not existing', () => {
    const properties = { a: 1 }
    const operations: PropertyOperations = {
      $setOnce: {
        a: 100,
        b: 2,
        c: 3,
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.a).toBe(1) // Preserved
    expect(result.b).toBe(2) // New
    expect(result.c).toBe(3) // New
  })

  it('should NOT overwrite null values', () => {
    const properties = { value: null }
    const operations: PropertyOperations = {
      $setOnce: { value: 'new' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.value).toBeNull()
  })

  it('should overwrite undefined values', () => {
    const properties: Record<string, unknown> = { value: undefined }
    const operations: PropertyOperations = {
      $setOnce: { value: 'new' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.value).toBe('new')
  })

  it('should NOT overwrite empty string', () => {
    const properties = { name: '' }
    const operations: PropertyOperations = {
      $setOnce: { name: 'John' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('')
  })

  it('should NOT overwrite zero', () => {
    const properties = { count: 0 }
    const operations: PropertyOperations = {
      $setOnce: { count: 100 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.count).toBe(0)
  })
})

// ============================================================================
// $add OPERATION TESTS
// ============================================================================

describe('$add operation', () => {
  it('should increment a numeric property', () => {
    const properties = { loginCount: 5 }
    const operations: PropertyOperations = {
      $add: { loginCount: 1 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.loginCount).toBe(6)
  })

  it('should handle negative increments (decrement)', () => {
    const properties = { credits: 100 }
    const operations: PropertyOperations = {
      $add: { credits: -25 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.credits).toBe(75)
  })

  it('should initialize property with value if not exists', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $add: { newCounter: 10 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.newCounter).toBe(10)
  })

  it('should handle float increments', () => {
    const properties = { balance: 100.5 }
    const operations: PropertyOperations = {
      $add: { balance: 0.25 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.balance).toBeCloseTo(100.75)
  })

  it('should increment multiple properties at once', () => {
    const properties = { a: 1, b: 2 }
    const operations: PropertyOperations = {
      $add: { a: 10, b: 20, c: 30 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.a).toBe(11)
    expect(result.b).toBe(22)
    expect(result.c).toBe(30)
  })

  it('should throw or skip when adding to non-numeric property', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $add: { name: 5 },
    }

    // Implementation can either throw or skip - test for one behavior
    expect(() => {
      applyPropertyOperations(properties, operations)
    }).toThrow()
  })

  it('should handle zero increment', () => {
    const properties = { count: 5 }
    const operations: PropertyOperations = {
      $add: { count: 0 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.count).toBe(5)
  })
})

// ============================================================================
// $append OPERATION TESTS
// ============================================================================

describe('$append operation', () => {
  it('should append value to existing array', () => {
    const properties = { tags: ['a', 'b'] }
    const operations: PropertyOperations = {
      $append: { tags: 'c' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['a', 'b', 'c'])
  })

  it('should create array with value if property does not exist', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $append: { tags: 'first' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['first'])
  })

  it('should append multiple values to different arrays', () => {
    const properties = { a: [1], b: [2] }
    const operations: PropertyOperations = {
      $append: { a: 10, b: 20, c: 30 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.a).toEqual([1, 10])
    expect(result.b).toEqual([2, 20])
    expect(result.c).toEqual([30])
  })

  it('should append object to array', () => {
    const properties = { items: [{ id: 1 }] }
    const operations: PropertyOperations = {
      $append: { items: { id: 2 } },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('should append null value', () => {
    const properties = { values: [1, 2] }
    const operations: PropertyOperations = {
      $append: { values: null },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.values).toEqual([1, 2, null])
  })

  it('should throw or skip when appending to non-array property', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $append: { name: 'Doe' },
    }

    expect(() => {
      applyPropertyOperations(properties, operations)
    }).toThrow()
  })

  it('should allow duplicate values in array', () => {
    const properties = { tags: ['a', 'b'] }
    const operations: PropertyOperations = {
      $append: { tags: 'a' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['a', 'b', 'a'])
  })
})

// ============================================================================
// $prepend OPERATION TESTS
// ============================================================================

describe('$prepend operation', () => {
  it('should prepend value to existing array', () => {
    const properties = { history: ['b', 'c'] }
    const operations: PropertyOperations = {
      $prepend: { history: 'a' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.history).toEqual(['a', 'b', 'c'])
  })

  it('should create array with value if property does not exist', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $prepend: { history: 'first' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.history).toEqual(['first'])
  })

  it('should prepend multiple values to different arrays', () => {
    const properties = { a: [1], b: [2] }
    const operations: PropertyOperations = {
      $prepend: { a: 0, b: 0, c: 0 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.a).toEqual([0, 1])
    expect(result.b).toEqual([0, 2])
    expect(result.c).toEqual([0])
  })

  it('should prepend object to array', () => {
    const properties = { items: [{ id: 2 }] }
    const operations: PropertyOperations = {
      $prepend: { items: { id: 1 } },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('should throw or skip when prepending to non-array property', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $prepend: { name: 'Mr.' },
    }

    expect(() => {
      applyPropertyOperations(properties, operations)
    }).toThrow()
  })
})

// ============================================================================
// $unset OPERATION TESTS
// ============================================================================

describe('$unset operation', () => {
  it('should remove a property entirely', () => {
    const properties = { name: 'John', email: 'john@example.com.ai' }
    const operations: PropertyOperations = {
      $unset: ['email'],
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
    expect('email' in result).toBe(false)
  })

  it('should remove multiple properties', () => {
    const properties = { a: 1, b: 2, c: 3 }
    const operations: PropertyOperations = {
      $unset: ['a', 'c'],
    }

    const result = applyPropertyOperations(properties, operations)

    expect('a' in result).toBe(false)
    expect(result.b).toBe(2)
    expect('c' in result).toBe(false)
  })

  it('should be a no-op if property does not exist', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $unset: ['nonexistent'],
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
    expect('nonexistent' in result).toBe(false)
  })

  it('should handle empty unset array', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $unset: [],
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
  })

  it('should unset nested objects', () => {
    const properties = { user: { name: 'John' }, settings: { theme: 'dark' } }
    const operations: PropertyOperations = {
      $unset: ['settings'],
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.user).toEqual({ name: 'John' })
    expect('settings' in result).toBe(false)
  })
})

// ============================================================================
// $remove OPERATION TESTS
// ============================================================================

describe('$remove operation', () => {
  it('should remove a value from array', () => {
    const properties = { tags: ['a', 'b', 'c'] }
    const operations: PropertyOperations = {
      $remove: { tags: 'b' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['a', 'c'])
  })

  it('should be a no-op if value not in array', () => {
    const properties = { tags: ['a', 'b', 'c'] }
    const operations: PropertyOperations = {
      $remove: { tags: 'd' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['a', 'b', 'c'])
  })

  it('should remove all occurrences of value', () => {
    const properties = { tags: ['a', 'b', 'a', 'c', 'a'] }
    const operations: PropertyOperations = {
      $remove: { tags: 'a' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.tags).toEqual(['b', 'c'])
  })

  it('should remove values from multiple arrays', () => {
    const properties = { a: [1, 2, 3], b: [4, 5, 6] }
    const operations: PropertyOperations = {
      $remove: { a: 2, b: 5 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.a).toEqual([1, 3])
    expect(result.b).toEqual([4, 6])
  })

  it('should be a no-op if property does not exist', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $remove: { tags: 'a' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
    expect('tags' in result).toBe(false)
  })

  it('should throw or skip when removing from non-array property', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $remove: { name: 'o' },
    }

    expect(() => {
      applyPropertyOperations(properties, operations)
    }).toThrow()
  })

  it('should remove object values using deep equality', () => {
    const properties = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const operations: PropertyOperations = {
      $remove: { items: { id: 2 } },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.items).toEqual([{ id: 1 }, { id: 3 }])
  })
})

// ============================================================================
// COMBINED OPERATIONS TESTS
// ============================================================================

describe('combined operations', () => {
  it('should apply multiple operation types in sequence', () => {
    const properties = {
      name: 'John',
      count: 5,
      tags: ['a'],
    }
    const operations: PropertyOperations = {
      $set: { email: 'john@example.com.ai' },
      $add: { count: 1 },
      $append: { tags: 'b' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
    expect(result.email).toBe('john@example.com.ai')
    expect(result.count).toBe(6)
    expect(result.tags).toEqual(['a', 'b'])
  })

  it('should apply operations in correct order ($set before $setOnce)', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $set: { value: 'set' },
      $setOnce: { value: 'setOnce' },
    }

    const result = applyPropertyOperations(properties, operations)

    // $set runs first, then $setOnce sees property exists, keeps 'set'
    expect(result.value).toBe('set')
  })

  it('should apply $unset last', () => {
    const properties = { count: 5 }
    const operations: PropertyOperations = {
      $add: { count: 10 },
      $unset: ['count'],
    }

    const result = applyPropertyOperations(properties, operations)

    // $add runs first making count=15, then $unset removes it
    expect('count' in result).toBe(false)
  })

  it('should not mutate original properties object', () => {
    const properties = { name: 'John', tags: ['a'] }
    const operations: PropertyOperations = {
      $set: { name: 'Jane' },
      $append: { tags: 'b' },
    }

    applyPropertyOperations(properties, operations)

    expect(properties.name).toBe('John')
    expect(properties.tags).toEqual(['a'])
  })

  it('should handle empty operations object', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {}

    const result = applyPropertyOperations(properties, operations)

    expect(result).toEqual({ name: 'John' })
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  it('should handle empty properties object', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $set: { name: 'John' },
      $add: { count: 1 },
      $append: { tags: 'a' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.name).toBe('John')
    expect(result.count).toBe(1)
    expect(result.tags).toEqual(['a'])
  })

  it('should handle deeply nested operations', () => {
    const properties = {
      user: {
        profile: {
          settings: {
            theme: 'light',
          },
        },
      },
    }
    const operations: PropertyOperations = {
      $set: {
        user: {
          profile: {
            settings: {
              theme: 'dark',
              language: 'en',
            },
          },
        },
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.user.profile.settings.theme).toBe('dark')
    expect(result.user.profile.settings.language).toBe('en')
  })

  it('should preserve prototype chain of result', () => {
    const properties = { name: 'John' }
    const operations: PropertyOperations = {
      $set: { email: 'john@example.com.ai' },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.hasOwnProperty).toBeDefined()
    expect(result.toString).toBeDefined()
  })

  it('should handle special characters in property names', () => {
    const properties = {}
    const operations: PropertyOperations = {
      $set: {
        'property-with-dash': 'value1',
        'property.with.dots': 'value2',
        'property with spaces': 'value3',
      },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result['property-with-dash']).toBe('value1')
    expect(result['property.with.dots']).toBe('value2')
    expect(result['property with spaces']).toBe('value3')
  })

  it('should handle Date objects', () => {
    const now = new Date()
    const properties = {}
    const operations: PropertyOperations = {
      $set: { createdAt: now },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.createdAt).toBe(now)
  })

  it('should handle very large numbers', () => {
    const properties = { bigNum: Number.MAX_SAFE_INTEGER - 1 }
    const operations: PropertyOperations = {
      $add: { bigNum: 1 },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.bigNum).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('should handle boolean values', () => {
    const properties = { active: false }
    const operations: PropertyOperations = {
      $set: { active: true },
      $setOnce: { verified: false },
    }

    const result = applyPropertyOperations(properties, operations)

    expect(result.active).toBe(true)
    expect(result.verified).toBe(false)
  })
})

// ============================================================================
// CONVENIENCE HELPER FUNCTION TESTS
// ============================================================================

describe('convenience helper functions', () => {
  describe('setProperty', () => {
    it('should create a $set operation for a single property', () => {
      const ops = setProperty('name', 'John')

      expect(ops).toEqual({ $set: { name: 'John' } })
    })

    it('should work with applyPropertyOperations', () => {
      const result = applyPropertyOperations({}, setProperty('name', 'John'))

      expect(result.name).toBe('John')
    })

    it('should be type-safe with generics', () => {
      const ops = setProperty<number>('count', 42)

      expect(ops.$set?.count).toBe(42)
    })
  })

  describe('setPropertyOnce', () => {
    it('should create a $setOnce operation', () => {
      const ops = setPropertyOnce('firstSeen', '2024-01-01')

      expect(ops).toEqual({ $setOnce: { firstSeen: '2024-01-01' } })
    })

    it('should not overwrite existing property', () => {
      const result = applyPropertyOperations({ firstSeen: 'old' }, setPropertyOnce('firstSeen', 'new'))

      expect(result.firstSeen).toBe('old')
    })
  })

  describe('incrementProperty', () => {
    it('should create an $add operation with default amount 1', () => {
      const ops = incrementProperty('count')

      expect(ops).toEqual({ $add: { count: 1 } })
    })

    it('should create an $add operation with custom amount', () => {
      const ops = incrementProperty('count', 5)

      expect(ops).toEqual({ $add: { count: 5 } })
    })

    it('should increment numeric property', () => {
      const result = applyPropertyOperations({ count: 10 }, incrementProperty('count', 5))

      expect(result.count).toBe(15)
    })
  })

  describe('decrementProperty', () => {
    it('should create an $add operation with negative default amount', () => {
      const ops = decrementProperty('credits')

      expect(ops).toEqual({ $add: { credits: -1 } })
    })

    it('should create an $add operation with negative custom amount', () => {
      const ops = decrementProperty('credits', 10)

      expect(ops).toEqual({ $add: { credits: -10 } })
    })

    it('should decrement numeric property', () => {
      const result = applyPropertyOperations({ credits: 100 }, decrementProperty('credits', 25))

      expect(result.credits).toBe(75)
    })
  })

  describe('appendProperty', () => {
    it('should create an $append operation', () => {
      const ops = appendProperty('tags', 'premium')

      expect(ops).toEqual({ $append: { tags: 'premium' } })
    })

    it('should append to array property', () => {
      const result = applyPropertyOperations({ tags: ['user'] }, appendProperty('tags', 'vip'))

      expect(result.tags).toEqual(['user', 'vip'])
    })

    it('should create array if property does not exist', () => {
      const result = applyPropertyOperations({}, appendProperty('tags', 'first'))

      expect(result.tags).toEqual(['first'])
    })
  })

  describe('prependProperty', () => {
    it('should create a $prepend operation', () => {
      const ops = prependProperty('history', 'latest')

      expect(ops).toEqual({ $prepend: { history: 'latest' } })
    })

    it('should prepend to array property', () => {
      const result = applyPropertyOperations({ history: ['old'] }, prependProperty('history', 'new'))

      expect(result.history).toEqual(['new', 'old'])
    })
  })

  describe('unsetProperty', () => {
    it('should create an $unset operation for single property', () => {
      const ops = unsetProperty('temp')

      expect(ops).toEqual({ $unset: ['temp'] })
    })

    it('should create an $unset operation for multiple properties', () => {
      const ops = unsetProperty('a', 'b', 'c')

      expect(ops).toEqual({ $unset: ['a', 'b', 'c'] })
    })

    it('should remove properties from object', () => {
      const result = applyPropertyOperations({ name: 'John', temp: 'xyz' }, unsetProperty('temp'))

      expect(result.name).toBe('John')
      expect('temp' in result).toBe(false)
    })
  })

  describe('removeFromProperty', () => {
    it('should create a $remove operation', () => {
      const ops = removeFromProperty('tags', 'deprecated')

      expect(ops).toEqual({ $remove: { tags: 'deprecated' } })
    })

    it('should remove value from array', () => {
      const result = applyPropertyOperations({ tags: ['active', 'deprecated'] }, removeFromProperty('tags', 'deprecated'))

      expect(result.tags).toEqual(['active'])
    })
  })
})

// ============================================================================
// PROPERTY OPS BUILDER TESTS
// ============================================================================

describe('PropertyOpsBuilder', () => {
  it('should create an empty builder', () => {
    const builder = propertyOps()

    expect(builder).toBeInstanceOf(PropertyOpsBuilder)
    expect(builder.build()).toEqual({})
  })

  it('should support fluent chaining for $set', () => {
    const ops = propertyOps()
      .set('name', 'John')
      .set('email', 'john@example.com.ai')
      .build()

    expect(ops.$set).toEqual({ name: 'John', email: 'john@example.com.ai' })
  })

  it('should support fluent chaining for multiple operation types', () => {
    const ops = propertyOps()
      .set('name', 'John')
      .setOnce('firstSeen', '2024-01-01')
      .increment('loginCount', 1)
      .append('tags', 'premium')
      .build()

    expect(ops.$set).toEqual({ name: 'John' })
    expect(ops.$setOnce).toEqual({ firstSeen: '2024-01-01' })
    expect(ops.$add).toEqual({ loginCount: 1 })
    expect(ops.$append).toEqual({ tags: 'premium' })
  })

  it('should support increment with default value', () => {
    const ops = propertyOps().increment('count').build()

    expect(ops.$add).toEqual({ count: 1 })
  })

  it('should support decrement', () => {
    const ops = propertyOps().decrement('credits', 10).build()

    expect(ops.$add).toEqual({ credits: -10 })
  })

  it('should support prepend', () => {
    const ops = propertyOps().prepend('history', 'latest').build()

    expect(ops.$prepend).toEqual({ history: 'latest' })
  })

  it('should support remove', () => {
    const ops = propertyOps().remove('tags', 'old').build()

    expect(ops.$remove).toEqual({ tags: 'old' })
  })

  it('should support unset', () => {
    const ops = propertyOps().unset('temp').unset('old').build()

    expect(ops.$unset).toEqual(['temp', 'old'])
  })

  it('should apply operations directly', () => {
    const result = propertyOps()
      .set('name', 'John')
      .increment('visits', 1)
      .apply({ visits: 5 })

    expect(result.name).toBe('John')
    expect(result.visits).toBe(6)
  })

  it('should handle complex chained operations', () => {
    const result = propertyOps()
      .set('email', 'john@example.com.ai')
      .setOnce('createdAt', '2024-01-01')
      .increment('loginCount', 1)
      .decrement('credits', 5)
      .append('tags', 'active')
      .prepend('history', 'login')
      .apply({ loginCount: 10, credits: 100, tags: ['user'], history: ['old'] })

    expect(result.email).toBe('john@example.com.ai')
    expect(result.createdAt).toBe('2024-01-01')
    expect(result.loginCount).toBe(11)
    expect(result.credits).toBe(95)
    expect(result.tags).toEqual(['user', 'active'])
    expect(result.history).toEqual(['login', 'old'])
  })
})

// ============================================================================
// BATCH OPERATIONS TESTS
// ============================================================================

describe('batch operations', () => {
  describe('batchApplyOperations', () => {
    it('should apply same operations to multiple users', () => {
      const users = {
        'user-1': { loginCount: 5, tags: ['a'] },
        'user-2': { loginCount: 10, tags: ['b'] },
      }
      const ops: PropertyOperations = {
        $add: { loginCount: 1 },
        $append: { tags: 'updated' },
      }

      const results = batchApplyOperations(users, ops)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        userId: 'user-1',
        properties: { loginCount: 6, tags: ['a', 'updated'] },
        success: true,
      })
      expect(results[1]).toEqual({
        userId: 'user-2',
        properties: { loginCount: 11, tags: ['b', 'updated'] },
        success: true,
      })
    })

    it('should handle errors gracefully', () => {
      const users = {
        'user-1': { count: 5 },
        'user-2': { count: 'not a number' }, // Will cause $add to fail
      }
      const ops: PropertyOperations = {
        $add: { count: 1 },
      }

      const results = batchApplyOperations(users, ops)

      expect(results[0].success).toBe(true)
      expect(results[0].properties).toEqual({ count: 6 })

      expect(results[1].success).toBe(false)
      expect(results[1].error).toBeInstanceOf(Error)
      expect(results[1].properties).toEqual({ count: 'not a number' }) // Original preserved
    })

    it('should handle empty users object', () => {
      const results = batchApplyOperations({}, { $set: { name: 'John' } })

      expect(results).toEqual([])
    })
  })

  describe('batchApplyDifferentOperations', () => {
    it('should apply different operations to each user', () => {
      const batch = [
        { userId: 'user-1', properties: { count: 5 }, operations: { $add: { count: 1 } } },
        { userId: 'user-2', properties: { name: 'Jane' }, operations: { $set: { name: 'John' } } },
      ]

      const results = batchApplyDifferentOperations(batch)

      expect(results[0].properties).toEqual({ count: 6 })
      expect(results[1].properties).toEqual({ name: 'John' })
    })

    it('should handle errors in mixed batch', () => {
      const batch = [
        { userId: 'user-1', properties: { count: 5 }, operations: { $add: { count: 1 } } },
        { userId: 'user-2', properties: { count: 'invalid' }, operations: { $add: { count: 1 } } },
        { userId: 'user-3', properties: { name: 'Jane' }, operations: { $set: { name: 'John' } } },
      ]

      const results = batchApplyDifferentOperations(batch)

      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[2].success).toBe(true)
    })

    it('should handle empty batch', () => {
      const results = batchApplyDifferentOperations([])

      expect(results).toEqual([])
    })
  })
})

// ============================================================================
// USER PROPERTY MANAGER TESTS
// ============================================================================

describe('UserPropertyManager', () => {
  it('should create manager with userId and properties', () => {
    const user = userProperties('user-123', { name: 'John' })

    expect(user.userId).toBe('user-123')
    expect(user.getProperties()).toEqual({ name: 'John' })
  })

  it('should create manager with empty properties by default', () => {
    const user = userProperties('user-123')

    expect(user.getProperties()).toEqual({})
  })

  it('should support fluent set operation', () => {
    const user = userProperties('user-123')
      .set('name', 'John')
      .set('email', 'john@example.com.ai')

    expect(user.getProperties()).toEqual({ name: 'John', email: 'john@example.com.ai' })
  })

  it('should support setOnce operation', () => {
    const user = userProperties('user-123', { firstSeen: 'old' })
      .setOnce('firstSeen', 'new')
      .setOnce('createdAt', '2024-01-01')

    const props = user.getProperties()
    expect(props.firstSeen).toBe('old') // Not overwritten
    expect(props.createdAt).toBe('2024-01-01') // New
  })

  it('should support increment and decrement', () => {
    const user = userProperties('user-123', { count: 10, credits: 100 })
      .increment('count', 5)
      .decrement('credits', 25)

    const props = user.getProperties()
    expect(props.count).toBe(15)
    expect(props.credits).toBe(75)
  })

  it('should support increment with default value', () => {
    const user = userProperties('user-123', { loginCount: 5 })
      .increment('loginCount')

    expect(user.getProperties().loginCount).toBe(6)
  })

  it('should support append and prepend', () => {
    const user = userProperties('user-123', { tags: ['b'], history: ['old'] })
      .append('tags', 'c')
      .prepend('history', 'new')

    const props = user.getProperties()
    expect(props.tags).toEqual(['b', 'c'])
    expect(props.history).toEqual(['new', 'old'])
  })

  it('should support remove operation', () => {
    const user = userProperties('user-123', { tags: ['a', 'b', 'c'] })
      .remove('tags', 'b')

    expect(user.getProperties().tags).toEqual(['a', 'c'])
  })

  it('should support unset operation', () => {
    const user = userProperties('user-123', { name: 'John', temp: 'xyz' })
      .unset('temp')

    const props = user.getProperties()
    expect(props.name).toBe('John')
    expect('temp' in props).toBe(false)
  })

  it('should support apply method for complex operations', () => {
    const user = userProperties('user-123', { count: 5, tags: ['a'] })
      .apply({
        $add: { count: 10 },
        $append: { tags: 'b' },
        $set: { name: 'John' },
      })

    const props = user.getProperties()
    expect(props.count).toBe(15)
    expect(props.tags).toEqual(['a', 'b'])
    expect(props.name).toBe('John')
  })

  it('should return immutable copy from getProperties', () => {
    const user = userProperties('user-123', { name: 'John' })
    const props1 = user.getProperties()
    props1.name = 'Jane' // Mutate the copy
    const props2 = user.getProperties()

    expect(props2.name).toBe('John') // Original unchanged
  })

  it('should support toResult method', () => {
    const user = userProperties('user-123', { name: 'John' })
      .increment('loginCount')

    const result = user.toResult()

    expect(result).toEqual({
      userId: 'user-123',
      properties: { name: 'John', loginCount: 1 },
      success: true,
    })
  })

  it('should be instanceof UserPropertyManager', () => {
    const user = userProperties('user-123')

    expect(user).toBeInstanceOf(UserPropertyManager)
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('utility functions', () => {
  describe('mergeOperations', () => {
    it('should merge two operations with different keys', () => {
      const ops1: PropertyOperations = { $set: { a: 1 } }
      const ops2: PropertyOperations = { $set: { b: 2 } }

      const merged = mergeOperations(ops1, ops2)

      expect(merged.$set).toEqual({ a: 1, b: 2 })
    })

    it('should override conflicting keys (later wins)', () => {
      const ops1: PropertyOperations = { $set: { a: 1 } }
      const ops2: PropertyOperations = { $set: { a: 2 } }

      const merged = mergeOperations(ops1, ops2)

      expect(merged.$set).toEqual({ a: 2 })
    })

    it('should merge all operation types', () => {
      const ops1: PropertyOperations = {
        $set: { a: 1 },
        $add: { count: 1 },
        $unset: ['temp'],
      }
      const ops2: PropertyOperations = {
        $set: { b: 2 },
        $append: { tags: 'x' },
        $unset: ['old'],
      }

      const merged = mergeOperations(ops1, ops2)

      expect(merged.$set).toEqual({ a: 1, b: 2 })
      expect(merged.$add).toEqual({ count: 1 })
      expect(merged.$append).toEqual({ tags: 'x' })
      expect(merged.$unset).toEqual(['temp', 'old'])
    })

    it('should handle multiple operations', () => {
      const merged = mergeOperations(
        { $set: { a: 1 } },
        { $set: { b: 2 } },
        { $set: { c: 3 } }
      )

      expect(merged.$set).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should handle empty operations', () => {
      const merged = mergeOperations({}, { $set: { a: 1 } }, {})

      expect(merged.$set).toEqual({ a: 1 })
    })

    it('should return empty object when merging empty operations', () => {
      const merged = mergeOperations({}, {})

      expect(merged).toEqual({})
    })
  })

  describe('isEmptyOperations', () => {
    it('should return true for empty object', () => {
      expect(isEmptyOperations({})).toBe(true)
    })

    it('should return true for operations with empty $set', () => {
      expect(isEmptyOperations({ $set: {} })).toBe(true)
    })

    it('should return true for operations with empty $unset', () => {
      expect(isEmptyOperations({ $unset: [] })).toBe(true)
    })

    it('should return true for operations with all empty fields', () => {
      expect(isEmptyOperations({
        $set: {},
        $setOnce: {},
        $add: {},
        $append: {},
        $prepend: {},
        $remove: {},
        $unset: [],
      })).toBe(true)
    })

    it('should return false for operations with $set value', () => {
      expect(isEmptyOperations({ $set: { name: 'John' } })).toBe(false)
    })

    it('should return false for operations with $add value', () => {
      expect(isEmptyOperations({ $add: { count: 1 } })).toBe(false)
    })

    it('should return false for operations with $unset values', () => {
      expect(isEmptyOperations({ $unset: ['temp'] })).toBe(false)
    })
  })
})
