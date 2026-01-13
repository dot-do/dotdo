import { describe, it, expect } from 'vitest'

/**
 * Response Shape Builder Tests (RED Phase)
 *
 * These tests verify the buildResponse function that adds JSON-LD style
 * linked data properties ($context, $type, $id) to plain objects.
 *
 * They are expected to FAIL until lib/response/linked-data.ts is implemented.
 *
 * Expected function signature:
 *
 * interface ResponseOptions {
 *   ns: string           // namespace like "https://headless.ly"
 *   type: string         // e.g., "Customer"
 *   id?: string          // e.g., "alice" (undefined for collection)
 *   parent?: string      // parent namespace for root responses
 *   isRoot?: boolean     // true if this is the DO root response
 *   isCollection?: boolean  // true for collection responses
 * }
 *
 * export function buildResponse<T extends object>(data: T, options: ResponseOptions): T & {
 *   $context: string
 *   $type: string
 *   $id: string
 * }
 *
 * URL Format:
 * - $context: The namespace URL (or parent for root responses)
 * - $type: namespace + '/' + pluralize(type) (or namespace for root)
 * - $id: $type + '/' + id (or $type for collection, or namespace for root)
 */

// Import the module under test (will fail until implemented)
import { buildResponse } from '../linked-data'

// ============================================================================
// Item Response Tests
// ============================================================================

describe('buildResponse - item responses', () => {
  describe('basic item response', () => {
    it('adds $context, $type, $id to plain object', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers/alice')
      expect(result.name).toBe('Alice')
    })

    it('preserves all original data properties', () => {
      const result = buildResponse(
        { name: 'Alice', email: 'alice@example.com', age: 30 },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
      expect(result.age).toBe(30)
      expect(result.$context).toBeDefined()
      expect(result.$type).toBeDefined()
      expect(result.$id).toBeDefined()
    })

    it('handles nested objects in data', () => {
      const result = buildResponse(
        { name: 'Alice', address: { city: 'NYC', zip: '10001' } },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      expect(result.address).toEqual({ city: 'NYC', zip: '10001' })
      expect(result.$id).toBe('https://headless.ly/customers/alice')
    })

    it('handles arrays in data', () => {
      const result = buildResponse(
        { name: 'Alice', tags: ['vip', 'enterprise'] },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      expect(result.tags).toEqual(['vip', 'enterprise'])
      expect(result.$id).toBe('https://headless.ly/customers/alice')
    })
  })

  describe('different entity types', () => {
    it('handles Contact type', () => {
      const result = buildResponse(
        { name: 'Bob' },
        { ns: 'https://crm.example.org.ai/acme', type: 'Contact', id: 'ord-123' }
      )

      expect(result.$context).toBe('https://crm.example.org.ai/acme')
      expect(result.$type).toBe('https://crm.example.org.ai/acme/contacts')
      expect(result.$id).toBe('https://crm.example.org.ai/acme/contacts/ord-123')
    })

    it('handles Deal type', () => {
      const result = buildResponse(
        { value: 50000 },
        { ns: 'https://Startups.Studio', type: 'Deal', id: 'acme' }
      )

      expect(result.$context).toBe('https://Startups.Studio')
      expect(result.$type).toBe('https://Startups.Studio/deals')
      expect(result.$id).toBe('https://Startups.Studio/deals/acme')
    })

    it('handles Person type with irregular pluralization', () => {
      const result = buildResponse(
        { name: 'John' },
        { ns: 'https://headless.ly', type: 'Person', id: 'john' }
      )

      expect(result.$type).toBe('https://headless.ly/people')
      expect(result.$id).toBe('https://headless.ly/people/john')
    })

    it('handles Category type (y -> ies pluralization)', () => {
      const result = buildResponse(
        { name: 'Tech' },
        { ns: 'https://headless.ly', type: 'Category', id: 'tech' }
      )

      expect(result.$type).toBe('https://headless.ly/categories')
      expect(result.$id).toBe('https://headless.ly/categories/tech')
    })
  })

  describe('special characters in id', () => {
    it('URL-encodes @ symbol in id', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'user@example.com' }
      )

      expect(result.$id).toBe('https://headless.ly/customers/user%40example.com')
    })

    it('URL-encodes spaces in id', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice bob' }
      )

      expect(result.$id).toBe('https://headless.ly/customers/alice%20bob')
    })

    it('preserves hyphens in id', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice-bob' }
      )

      expect(result.$id).toBe('https://headless.ly/customers/alice-bob')
    })

    it('preserves dots in id (like domain names)', () => {
      const result = buildResponse(
        { name: 'Example' },
        { ns: 'https://headless.ly', type: 'Domain', id: 'example.com' }
      )

      expect(result.$id).toBe('https://headless.ly/domains/example.com')
    })
  })
})

// ============================================================================
// Collection Response Tests
// ============================================================================

describe('buildResponse - collection responses', () => {
  describe('basic collection response', () => {
    it('sets $type equal to $id for collection', () => {
      const result = buildResponse(
        { items: [] },
        { ns: 'https://headless.ly', type: 'Customer', isCollection: true }
      )

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers')
    })

    it('handles collection with items', () => {
      const result = buildResponse(
        { items: [{ name: 'Alice' }, { name: 'Bob' }], count: 2 },
        { ns: 'https://headless.ly', type: 'Customer', isCollection: true }
      )

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers')
      expect(result.items).toEqual([{ name: 'Alice' }, { name: 'Bob' }])
      expect(result.count).toBe(2)
    })

    it('handles Contact collection', () => {
      const result = buildResponse(
        { items: [], total: 0 },
        { ns: 'https://crm.example.org.ai/acme', type: 'Contact', isCollection: true }
      )

      expect(result.$context).toBe('https://crm.example.org.ai/acme')
      expect(result.$type).toBe('https://crm.example.org.ai/acme/contacts')
      expect(result.$id).toBe('https://crm.example.org.ai/acme/contacts')
    })
  })

  describe('collection pagination metadata', () => {
    it('preserves pagination properties', () => {
      const result = buildResponse(
        { items: [], page: 1, pageSize: 20, total: 100 },
        { ns: 'https://headless.ly', type: 'Customer', isCollection: true }
      )

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(result.total).toBe(100)
      expect(result.$type).toBe(result.$id)
    })
  })
})

// ============================================================================
// Root Response Tests
// ============================================================================

describe('buildResponse - root responses', () => {
  describe('basic root response', () => {
    it('uses parent as $context when isRoot is true', () => {
      const result = buildResponse(
        { name: 'My Startup' },
        {
          ns: 'https://headless.ly',
          type: 'Startup',
          isRoot: true,
          parent: 'https://Startups.Studio',
        }
      )

      expect(result.$context).toBe('https://Startups.Studio')
      expect(result.$type).toBe('https://headless.ly')
      expect(result.$id).toBe('https://headless.ly')
      expect(result.name).toBe('My Startup')
    })

    it('sets $type and $id to namespace for root', () => {
      const result = buildResponse(
        { name: 'Acme Corp' },
        {
          ns: 'https://acme.headless.ly',
          type: 'Organization',
          isRoot: true,
          parent: 'https://headless.ly',
        }
      )

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://acme.headless.ly')
      expect(result.$id).toBe('https://acme.headless.ly')
    })
  })

  describe('root response without parent', () => {
    it('uses schema.org.ai type URL as $context when no parent provided (orphan fallback)', () => {
      // When isRoot is true and no parent is provided (orphan DO),
      // $context falls back to schema.org.ai type definition URL
      const result = buildResponse(
        { name: 'Root Entity' },
        {
          ns: 'https://headless.ly',
          type: 'Root',
          isRoot: true,
        }
      )

      // Orphan root should use schema.org.ai/{type} as context
      expect(result.$context).toBe('https://schema.org.ai/Root')
      expect(result.$type).toBe('https://headless.ly')
      expect(result.$id).toBe('https://headless.ly')
    })
  })

  describe('root response with rich data', () => {
    it('preserves complex root entity data', () => {
      const result = buildResponse(
        {
          name: 'My Startup',
          hypothesis: 'AI will transform business',
          team: ['priya', 'ralph', 'tom'],
          metrics: { mrr: 10000, customers: 50 },
        },
        {
          ns: 'https://mystartup.headless.ly',
          type: 'Startup',
          isRoot: true,
          parent: 'https://Startups.Studio',
        }
      )

      expect(result.name).toBe('My Startup')
      expect(result.hypothesis).toBe('AI will transform business')
      expect(result.team).toEqual(['priya', 'ralph', 'tom'])
      expect(result.metrics).toEqual({ mrr: 10000, customers: 50 })
      expect(result.$context).toBe('https://Startups.Studio')
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('buildResponse - edge cases', () => {
  describe('namespace variations', () => {
    it('handles namespace with port', () => {
      const result = buildResponse(
        { name: 'Test' },
        { ns: 'https://localhost:8787', type: 'Customer', id: 'test' }
      )

      expect(result.$context).toBe('https://localhost:8787')
      expect(result.$type).toBe('https://localhost:8787/customers')
      expect(result.$id).toBe('https://localhost:8787/customers/test')
    })

    it('handles namespace with path segments', () => {
      const result = buildResponse(
        { name: 'Test' },
        { ns: 'https://api.example.com/v1/tenant', type: 'Customer', id: 'test' }
      )

      expect(result.$context).toBe('https://api.example.com/v1/tenant')
      expect(result.$type).toBe('https://api.example.com/v1/tenant/customers')
      expect(result.$id).toBe('https://api.example.com/v1/tenant/customers/test')
    })

    it('handles namespace with trailing slash', () => {
      const result = buildResponse(
        { name: 'Test' },
        { ns: 'https://headless.ly/', type: 'Customer', id: 'test' }
      )

      // Should normalize - no double slashes
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers/test')
    })
  })

  describe('empty data object', () => {
    it('adds linked data to empty object', () => {
      const result = buildResponse(
        {},
        { ns: 'https://headless.ly', type: 'Customer', id: 'empty' }
      )

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers/empty')
      expect(Object.keys(result)).toEqual(['$context', '$type', '$id'])
    })
  })

  describe('data with conflicting properties', () => {
    it('overwrites existing $context in data', () => {
      const result = buildResponse(
        { $context: 'should-be-overwritten', name: 'Test' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'test' }
      )

      expect(result.$context).toBe('https://headless.ly')
    })

    it('overwrites existing $type in data', () => {
      const result = buildResponse(
        { $type: 'should-be-overwritten', name: 'Test' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'test' }
      )

      expect(result.$type).toBe('https://headless.ly/customers')
    })

    it('overwrites existing $id in data', () => {
      const result = buildResponse(
        { $id: 'should-be-overwritten', name: 'Test' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'test' }
      )

      expect(result.$id).toBe('https://headless.ly/customers/test')
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('buildResponse - type safety', () => {
  it('returns typed object with linked data properties', () => {
    const input = { name: 'Alice', age: 30 }
    const result = buildResponse(input, {
      ns: 'https://headless.ly',
      type: 'Customer',
      id: 'alice',
    })

    // TypeScript should know these exist
    const context: string = result.$context
    const type: string = result.$type
    const id: string = result.$id
    const name: string = result.name
    const age: number = result.age

    expect(typeof context).toBe('string')
    expect(typeof type).toBe('string')
    expect(typeof id).toBe('string')
    expect(typeof name).toBe('string')
    expect(typeof age).toBe('number')
  })

  it('preserves original type structure', () => {
    interface Customer {
      name: string
      email: string
    }

    const input: Customer = { name: 'Alice', email: 'alice@example.com' }
    const result = buildResponse(input, {
      ns: 'https://headless.ly',
      type: 'Customer',
      id: 'alice',
    })

    // Original properties should be accessible with correct types
    expect(result.name).toBe('Alice')
    expect(result.email).toBe('alice@example.com')
    expect(result.$context).toBeDefined()
  })
})

// ============================================================================
// Integration Tests - URL Consistency
// ============================================================================

describe('buildResponse - URL consistency', () => {
  it('$id starts with $type for item responses', () => {
    const result = buildResponse(
      { name: 'Alice' },
      { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
    )

    expect(result.$id.startsWith(result.$type)).toBe(true)
  })

  it('$type starts with $context for non-root responses', () => {
    const result = buildResponse(
      { name: 'Alice' },
      { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
    )

    expect(result.$type.startsWith(result.$context)).toBe(true)
  })

  it('$id equals $type for collection responses', () => {
    const result = buildResponse(
      { items: [] },
      { ns: 'https://headless.ly', type: 'Customer', isCollection: true }
    )

    expect(result.$id).toBe(result.$type)
  })

  it('$id equals $type equals namespace for root responses', () => {
    const result = buildResponse(
      { name: 'Root' },
      { ns: 'https://headless.ly', type: 'Root', isRoot: true }
    )

    expect(result.$id).toBe('https://headless.ly')
    expect(result.$type).toBe('https://headless.ly')
  })
})
