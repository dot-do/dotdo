import { describe, it, expect } from 'vitest'

/**
 * Response Shape Builder Tests
 *
 * These tests verify the buildResponse function that adds JSON-LD style
 * linked data properties ($context, $type, $id) to plain objects.
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

// Import the module under test
import { buildResponse, buildErrorResponse, type ErrorCode, type ErrorResponse } from '../linked-data'

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

// ============================================================================
// Error Response Tests
// ============================================================================

describe('buildErrorResponse', () => {
  describe('basic error responses', () => {
    it('builds NOT_FOUND error', () => {
      const result = buildErrorResponse('NOT_FOUND', 'Customer not found: alice')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('NOT_FOUND')
      expect(result.message).toBe('Customer not found: alice')
    })

    it('builds BAD_REQUEST error', () => {
      const result = buildErrorResponse('BAD_REQUEST', 'Invalid email format')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('BAD_REQUEST')
      expect(result.message).toBe('Invalid email format')
    })

    it('builds DUPLICATE error', () => {
      const result = buildErrorResponse('DUPLICATE', 'Customer already exists: alice')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('DUPLICATE')
      expect(result.message).toBe('Customer already exists: alice')
    })

    it('builds CREATE_FAILED error', () => {
      const result = buildErrorResponse('CREATE_FAILED', 'Database error')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('CREATE_FAILED')
      expect(result.message).toBe('Database error')
    })

    it('builds UPDATE_FAILED error', () => {
      const result = buildErrorResponse('UPDATE_FAILED', 'Constraint violation')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('UPDATE_FAILED')
      expect(result.message).toBe('Constraint violation')
    })

    it('builds DELETE_FAILED error', () => {
      const result = buildErrorResponse('DELETE_FAILED', 'Foreign key constraint')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('DELETE_FAILED')
      expect(result.message).toBe('Foreign key constraint')
    })

    it('builds METHOD_NOT_ALLOWED error', () => {
      const result = buildErrorResponse('METHOD_NOT_ALLOWED', 'PUT not supported')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('METHOD_NOT_ALLOWED')
      expect(result.message).toBe('PUT not supported')
    })

    it('builds UNSUPPORTED_MEDIA_TYPE error', () => {
      const result = buildErrorResponse('UNSUPPORTED_MEDIA_TYPE', 'Expected application/json')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('UNSUPPORTED_MEDIA_TYPE')
      expect(result.message).toBe('Expected application/json')
    })

    it('builds INTERNAL_ERROR error', () => {
      const result = buildErrorResponse('INTERNAL_ERROR', 'Unexpected server error')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('INTERNAL_ERROR')
      expect(result.message).toBe('Unexpected server error')
    })
  })

  describe('error response structure', () => {
    it('returns only $type, code, and message properties', () => {
      const result = buildErrorResponse('NOT_FOUND', 'Not found')

      expect(Object.keys(result).sort()).toEqual(['$type', 'code', 'message'])
    })

    it('has consistent structure across all error codes', () => {
      const errorCodes: ErrorCode[] = [
        'NOT_FOUND',
        'BAD_REQUEST',
        'DUPLICATE',
        'CREATE_FAILED',
        'UPDATE_FAILED',
        'DELETE_FAILED',
        'METHOD_NOT_ALLOWED',
        'UNSUPPORTED_MEDIA_TYPE',
        'INTERNAL_ERROR',
      ]

      for (const code of errorCodes) {
        const result = buildErrorResponse(code, `Test message for ${code}`)
        expect(result.$type).toBe('Error')
        expect(result.code).toBe(code)
        expect(typeof result.message).toBe('string')
      }
    })
  })

  describe('type safety', () => {
    it('returns ErrorResponse type', () => {
      const result: ErrorResponse = buildErrorResponse('NOT_FOUND', 'Not found')

      expect(result.$type).toBe('Error')
      expect(result.code).toBe('NOT_FOUND')
    })
  })
})

// ============================================================================
// Linked Data Embedding Tests
// ============================================================================

describe('linked data embedding', () => {
  describe('embedded related resources', () => {
    it('supports embedded objects with their own linked data properties', () => {
      // When a response includes a nested related object, each embedded
      // object can have its own $context, $type, $id
      const result = buildResponse(
        {
          name: 'Order 123',
          customer: {
            $type: 'https://headless.ly/customers',
            $id: 'https://headless.ly/customers/alice',
            name: 'Alice',
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      expect(result.$type).toBe('https://headless.ly/orders')
      expect(result.customer.$type).toBe('https://headless.ly/customers')
      expect(result.customer.$id).toBe('https://headless.ly/customers/alice')
      expect(result.customer.name).toBe('Alice')
    })

    it('supports arrays of embedded resources', () => {
      const result = buildResponse(
        {
          name: 'Order 123',
          items: [
            { $id: 'https://headless.ly/products/widget', name: 'Widget', qty: 2 },
            { $id: 'https://headless.ly/products/gadget', name: 'Gadget', qty: 1 },
          ],
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      expect(result.items).toHaveLength(2)
      expect(result.items[0].$id).toBe('https://headless.ly/products/widget')
      expect(result.items[1].$id).toBe('https://headless.ly/products/gadget')
    })

    it('preserves deeply nested embedded resources', () => {
      const result = buildResponse(
        {
          name: 'Organization',
          department: {
            name: 'Engineering',
            manager: {
              $id: 'https://headless.ly/contacts/jane',
              name: 'Jane',
              team: [
                { $id: 'https://headless.ly/contacts/bob', name: 'Bob' },
                { $id: 'https://headless.ly/contacts/alice', name: 'Alice' },
              ],
            },
          },
        },
        { ns: 'https://headless.ly', type: 'Organization', id: 'acme' }
      )

      expect(result.department.manager.$id).toBe('https://headless.ly/contacts/jane')
      expect(result.department.manager.team[0].$id).toBe('https://headless.ly/contacts/bob')
      expect(result.department.manager.team[1].$id).toBe('https://headless.ly/contacts/alice')
    })
  })

  describe('mixed references and embedded', () => {
    it('allows mix of URL references and embedded objects', () => {
      // Some relationships are just URLs (references), others are embedded
      const result = buildResponse(
        {
          name: 'Order 123',
          // URL reference - not expanded
          billingAddress: 'https://headless.ly/addresses/addr-1',
          // Embedded object - fully expanded
          shippingAddress: {
            $id: 'https://headless.ly/addresses/addr-2',
            street: '123 Main St',
            city: 'NYC',
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      // Reference is just a string URL
      expect(typeof result.billingAddress).toBe('string')
      expect(result.billingAddress).toBe('https://headless.ly/addresses/addr-1')

      // Embedded object has full structure
      expect(typeof result.shippingAddress).toBe('object')
      expect(result.shippingAddress.$id).toBe('https://headless.ly/addresses/addr-2')
      expect(result.shippingAddress.street).toBe('123 Main St')
    })
  })
})

// ============================================================================
// Reference Extraction Tests
// ============================================================================

describe('reference extraction', () => {
  describe('extracting $id references from data', () => {
    it('embedded objects contain $id for identity', () => {
      const result = buildResponse(
        {
          name: 'Order 123',
          customer: {
            $id: 'https://headless.ly/customers/alice',
            name: 'Alice',
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      // Extract the customer reference
      const customerRef = result.customer.$id
      expect(customerRef).toBe('https://headless.ly/customers/alice')
    })

    it('extracts all references from nested structures', () => {
      const data = {
        name: 'Project Alpha',
        owner: { $id: 'https://headless.ly/users/jane', name: 'Jane' },
        tasks: [
          { $id: 'https://headless.ly/tasks/task-1', title: 'Task 1' },
          { $id: 'https://headless.ly/tasks/task-2', title: 'Task 2' },
        ],
      }

      const result = buildResponse(data, {
        ns: 'https://headless.ly',
        type: 'Project',
        id: 'alpha',
      })

      // Extract all embedded references
      const refs = [
        result.owner.$id,
        ...result.tasks.map((t: { $id: string }) => t.$id),
      ]

      expect(refs).toContain('https://headless.ly/users/jane')
      expect(refs).toContain('https://headless.ly/tasks/task-1')
      expect(refs).toContain('https://headless.ly/tasks/task-2')
    })
  })

  describe('reference resolution', () => {
    it('string values that look like URLs can serve as references', () => {
      const result = buildResponse(
        {
          name: 'Order',
          customer: 'https://headless.ly/customers/alice',
          items: [
            'https://headless.ly/products/widget',
            'https://headless.ly/products/gadget',
          ],
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      // These are unresolved references (just URLs)
      expect(result.customer).toBe('https://headless.ly/customers/alice')
      expect(result.items[0]).toBe('https://headless.ly/products/widget')
    })
  })
})

// ============================================================================
// Deduplication Tests
// ============================================================================

describe('deduplication', () => {
  describe('duplicate embedded resources', () => {
    it('allows same resource to appear multiple times', () => {
      // In JSON responses, the same resource can appear in multiple places
      const alice = {
        $id: 'https://headless.ly/customers/alice',
        name: 'Alice',
      }

      const result = buildResponse(
        {
          name: 'Team Report',
          primaryContact: alice,
          billingContact: alice,
          technicalContact: alice,
        },
        { ns: 'https://headless.ly', type: 'Report', id: 'team-report' }
      )

      // All three point to same customer
      expect(result.primaryContact.$id).toBe('https://headless.ly/customers/alice')
      expect(result.billingContact.$id).toBe('https://headless.ly/customers/alice')
      expect(result.technicalContact.$id).toBe('https://headless.ly/customers/alice')
    })

    it('preserves object identity for same embedded resource', () => {
      const customer = {
        $id: 'https://headless.ly/customers/alice',
        name: 'Alice',
      }

      const result = buildResponse(
        {
          order1: { customer },
          order2: { customer },
        },
        { ns: 'https://headless.ly', type: 'Orders', id: 'batch' }
      )

      // Same object reference is preserved
      expect(result.order1.customer).toBe(result.order2.customer)
    })
  })

  describe('collection with duplicate references', () => {
    it('handles collections where multiple items reference same resource', () => {
      const category = {
        $id: 'https://headless.ly/categories/electronics',
        name: 'Electronics',
      }

      const result = buildResponse(
        {
          items: [
            { $id: 'https://headless.ly/products/phone', name: 'Phone', category },
            { $id: 'https://headless.ly/products/tablet', name: 'Tablet', category },
            { $id: 'https://headless.ly/products/laptop', name: 'Laptop', category },
          ],
        },
        { ns: 'https://headless.ly', type: 'Product', isCollection: true }
      )

      // All items reference the same category
      const categories = result.items.map((item: { category: { $id: string } }) => item.category.$id)
      expect(new Set(categories).size).toBe(1)
      expect(categories[0]).toBe('https://headless.ly/categories/electronics')
    })
  })
})

// ============================================================================
// Expansion Control Tests
// ============================================================================

describe('expansion control', () => {
  describe('selective expansion of relationships', () => {
    it('can represent relationship as URL-only (unexpanded)', () => {
      const result = buildResponse(
        {
          name: 'Order',
          // URL reference - client would need to fetch separately
          customer: 'https://headless.ly/customers/alice',
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      expect(typeof result.customer).toBe('string')
      expect(result.customer).toMatch(/^https:\/\//)
    })

    it('can represent relationship as fully expanded object', () => {
      const result = buildResponse(
        {
          name: 'Order',
          // Fully expanded - includes all customer data
          customer: {
            $context: 'https://headless.ly',
            $type: 'https://headless.ly/customers',
            $id: 'https://headless.ly/customers/alice',
            name: 'Alice',
            email: 'alice@example.com',
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      expect(typeof result.customer).toBe('object')
      expect(result.customer.name).toBe('Alice')
      expect(result.customer.email).toBe('alice@example.com')
    })

    it('supports partial expansion with minimal data', () => {
      const result = buildResponse(
        {
          name: 'Order',
          // Partially expanded - just enough for display
          customer: {
            $id: 'https://headless.ly/customers/alice',
            name: 'Alice',
            // email, address, etc. not included
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      expect(result.customer.$id).toBeDefined()
      expect(result.customer.name).toBe('Alice')
      expect(result.customer.email).toBeUndefined()
    })
  })

  describe('expansion depth control', () => {
    it('allows first-level expansion only', () => {
      const result = buildResponse(
        {
          name: 'Order',
          customer: {
            $id: 'https://headless.ly/customers/alice',
            name: 'Alice',
            // Company is just a reference, not expanded
            company: 'https://headless.ly/companies/acme',
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      // Customer is expanded
      expect(typeof result.customer).toBe('object')
      // But customer's company is just a reference
      expect(typeof result.customer.company).toBe('string')
    })

    it('allows multi-level expansion', () => {
      const result = buildResponse(
        {
          name: 'Order',
          customer: {
            $id: 'https://headless.ly/customers/alice',
            name: 'Alice',
            company: {
              $id: 'https://headless.ly/companies/acme',
              name: 'Acme Corp',
              // Third level - just reference
              headquarters: 'https://headless.ly/addresses/hq-1',
            },
          },
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      // Two levels expanded
      expect(result.customer.company.name).toBe('Acme Corp')
      // Third level is just a reference
      expect(typeof result.customer.company.headquarters).toBe('string')
    })
  })
})

// ============================================================================
// JSON-LD Compatibility Tests
// ============================================================================

describe('JSON-LD compatibility', () => {
  describe('$ vs @ prefix convention', () => {
    it('uses $ prefix for linked data properties (dotdo convention)', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      // dotdo uses $ prefix instead of @
      expect(result.$context).toBeDefined()
      expect(result.$type).toBeDefined()
      expect(result.$id).toBeDefined()

      // Should not have @ prefix
      expect((result as Record<string, unknown>)['@context']).toBeUndefined()
      expect((result as Record<string, unknown>)['@type']).toBeUndefined()
      expect((result as Record<string, unknown>)['@id']).toBeUndefined()
    })
  })

  describe('context URL semantics', () => {
    it('$context provides vocabulary/schema context', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      // $context points to the namespace that defines the vocabulary
      expect(result.$context).toBe('https://headless.ly')
    })

    it('$type provides collection/class URL', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      // $type is the collection URL (analogous to rdf:type)
      expect(result.$type).toBe('https://headless.ly/customers')
    })

    it('$id provides unique resource identifier', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      // $id is the unique, dereferenceable URL for this resource
      expect(result.$id).toBe('https://headless.ly/customers/alice')
    })
  })

  describe('linked data principles', () => {
    it('all identifiers are dereferenceable URLs', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      // All three should be valid URLs that could be fetched
      expect(result.$context).toMatch(/^https?:\/\//)
      expect(result.$type).toMatch(/^https?:\/\//)
      expect(result.$id).toMatch(/^https?:\/\//)
    })

    it('$id is unique per resource instance', () => {
      const alice = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      const bob = buildResponse(
        { name: 'Bob' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'bob' }
      )

      // Different instances have different $id
      expect(alice.$id).not.toBe(bob.$id)
      // But same $type (both are customers)
      expect(alice.$type).toBe(bob.$type)
    })

    it('resources can link to each other via URLs', () => {
      const customer = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      const order = buildResponse(
        {
          name: 'Order 123',
          customer: customer.$id, // Link using customer's $id
        },
        { ns: 'https://headless.ly', type: 'Order', id: 'order-123' }
      )

      // Order references customer by URL
      expect(order.customer).toBe('https://headless.ly/customers/alice')
      expect(order.customer).toBe(customer.$id)
    })
  })

  describe('type hierarchy', () => {
    it('$type URL represents the collection/class', () => {
      const result = buildResponse(
        { name: 'Alice' },
        { ns: 'https://headless.ly', type: 'Customer', id: 'alice' }
      )

      // $type is the collection URL - fetching it would return all customers
      expect(result.$type).toBe('https://headless.ly/customers')
      // $id is a specific member of that collection
      expect(result.$id.startsWith(result.$type)).toBe(true)
    })
  })
})

// ============================================================================
// Real-World Integration Tests
// ============================================================================

describe('real-world integration', () => {
  describe('e-commerce order response', () => {
    it('builds complete order with embedded customer and items', () => {
      const result = buildResponse(
        {
          orderNumber: 'ORD-2024-001',
          status: 'confirmed',
          total: 299.99,
          customer: {
            $id: 'https://shop.example.com/customers/alice',
            name: 'Alice Smith',
            email: 'alice@example.com',
          },
          items: [
            {
              $id: 'https://shop.example.com/products/widget-pro',
              name: 'Widget Pro',
              price: 149.99,
              quantity: 1,
            },
            {
              $id: 'https://shop.example.com/products/gadget-lite',
              name: 'Gadget Lite',
              price: 75.00,
              quantity: 2,
            },
          ],
          shippingAddress: 'https://shop.example.com/addresses/addr-123',
        },
        { ns: 'https://shop.example.com', type: 'Order', id: 'ORD-2024-001' }
      )

      // Order metadata
      expect(result.$context).toBe('https://shop.example.com')
      expect(result.$type).toBe('https://shop.example.com/orders')
      expect(result.$id).toBe('https://shop.example.com/orders/ORD-2024-001')

      // Embedded customer
      expect(result.customer.$id).toBe('https://shop.example.com/customers/alice')
      expect(result.customer.name).toBe('Alice Smith')

      // Embedded items
      expect(result.items).toHaveLength(2)
      expect(result.items[0].$id).toBe('https://shop.example.com/products/widget-pro')

      // Reference-only shipping address
      expect(typeof result.shippingAddress).toBe('string')
    })
  })

  describe('CRM contact graph', () => {
    it('builds contact with company and team relationships', () => {
      const result = buildResponse(
        {
          name: 'John Doe',
          title: 'Engineering Manager',
          email: 'john@acme.com',
          company: {
            $id: 'https://crm.example.com/companies/acme',
            name: 'Acme Corp',
            industry: 'Technology',
          },
          reportsTo: 'https://crm.example.com/contacts/jane',
          directReports: [
            {
              $id: 'https://crm.example.com/contacts/bob',
              name: 'Bob Smith',
            },
            {
              $id: 'https://crm.example.com/contacts/alice',
              name: 'Alice Johnson',
            },
          ],
        },
        { ns: 'https://crm.example.com', type: 'Contact', id: 'john' }
      )

      // Contact metadata
      expect(result.$id).toBe('https://crm.example.com/contacts/john')

      // Embedded company
      expect(result.company.$id).toBe('https://crm.example.com/companies/acme')

      // Reference-only manager
      expect(result.reportsTo).toBe('https://crm.example.com/contacts/jane')

      // Embedded direct reports
      expect(result.directReports).toHaveLength(2)
      expect(result.directReports[0].$id).toBe('https://crm.example.com/contacts/bob')
    })
  })

  describe('project management task', () => {
    it('builds task with project, assignee, and dependency references', () => {
      const result = buildResponse(
        {
          title: 'Implement user authentication',
          status: 'in_progress',
          priority: 'high',
          project: {
            $id: 'https://pm.example.org/projects/alpha',
            name: 'Project Alpha',
          },
          assignee: {
            $id: 'https://pm.example.org/users/jane',
            name: 'Jane Developer',
          },
          blockedBy: ['https://pm.example.org/tasks/task-100'],
          blocks: [
            'https://pm.example.org/tasks/task-102',
            'https://pm.example.org/tasks/task-103',
          ],
        },
        { ns: 'https://pm.example.org', type: 'Task', id: 'task-101' }
      )

      // Task metadata
      expect(result.$id).toBe('https://pm.example.org/tasks/task-101')

      // Embedded relationships
      expect(result.project.$id).toBe('https://pm.example.org/projects/alpha')
      expect(result.assignee.$id).toBe('https://pm.example.org/users/jane')

      // Reference-only dependencies
      expect(result.blockedBy).toEqual(['https://pm.example.org/tasks/task-100'])
      expect(result.blocks).toContain('https://pm.example.org/tasks/task-102')
    })
  })
})
