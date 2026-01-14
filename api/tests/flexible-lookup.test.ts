import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * Flexible REST Lookup Tests (do-3jm)
 *
 * These tests verify flexible lookup support for GET /api/:type/:lookup
 * where :lookup can be either an ID or a name field value.
 *
 * Examples:
 * - GET /customers/123 → lookup by $id
 * - GET /customers/Alice → lookup by name field
 * - GET /customers/uuid-abc-def → lookup by $id (UUID format)
 *
 * The functions tested here don't exist yet - this is TDD RED phase.
 * Implementation should be in: api/utils/lookup.ts
 */

// @ts-expect-error - lookup.ts not yet created
import { isValidId, buildLookupQuery } from '../../utils/lookup'

// ============================================================================
// Test Types
// ============================================================================

interface Customer {
  $id: string
  name: string
  email?: string
}

interface LookupQuery {
  [key: string]: string | number
}

// ============================================================================
// Helper Setup
// ============================================================================

const mockDb = {
  query: {
    customers: {
      findFirst: vi.fn(),
    },
  },
}

function createTestApp(): Hono {
  const app = new Hono()

  // Mock auth middleware
  app.use('*', async (c, next) => {
    c.set('db', mockDb)
    await next()
  })

  // Flexible lookup route handler
  app.get('/api/customers/:lookup', async (c: Context) => {
    const lookup = c.req.param('lookup')
    const db = c.get('db')

    // Build lookup query using the utility function
    const query = buildLookupQuery(lookup, 'customers')

    // Query the database with the constructed query
    const result = await db.query.customers.findFirst({
      where: query,
    })

    if (!result) {
      return c.json({ error: 'Not found' }, 404)
    }

    return c.json(result)
  })

  return app
}

// ============================================================================
// 1. isValidId() Tests
// ============================================================================

describe('isValidId() - Distinguish IDs from names', () => {
  describe('Numeric string IDs', () => {
    it('returns true for numeric string "123"', () => {
      expect(isValidId('123')).toBe(true)
    })

    it('returns true for numeric string "999999"', () => {
      expect(isValidId('999999')).toBe(true)
    })

    it('returns true for "0"', () => {
      expect(isValidId('0')).toBe(true)
    })

    it('returns true for leading-zero numbers like "000123"', () => {
      expect(isValidId('000123')).toBe(true)
    })
  })

  describe('UUID-like IDs', () => {
    it('returns true for UUID v4: "550e8400-e29b-41d4-a716-446655440000"', () => {
      expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('returns true for UUID-like: "abc-def-ghi"', () => {
      expect(isValidId('abc-def-ghi')).toBe(true)
    })

    it('returns true for ULID: "01ARZ3NDEKTSV4RRFFQ69G5FAV"', () => {
      expect(isValidId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true)
    })

    it('returns true for hyphenated hex: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"', () => {
      expect(isValidId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true)
    })

    it('returns true for multiple hyphens: "id-with-multiple-segments"', () => {
      expect(isValidId('id-with-multiple-segments')).toBe(true)
    })
  })

  describe('Name-like values', () => {
    it('returns false for simple name "Alice"', () => {
      expect(isValidId('Alice')).toBe(false)
    })

    it('returns false for email-like "alice@example.com"', () => {
      expect(isValidId('alice@example.com')).toBe(false)
    })

    it('returns false for space-containing "John Doe"', () => {
      expect(isValidId('John Doe')).toBe(false)
    })

    it('returns false for lowercase name "bob"', () => {
      expect(isValidId('bob')).toBe(false)
    })

    it('returns false for mixed case name "Charlie"', () => {
      expect(isValidId('Charlie')).toBe(false)
    })

    it('returns false for name with special chars "user@name"', () => {
      expect(isValidId('user@name')).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('returns true for very long numeric string', () => {
      expect(isValidId('12345678901234567890')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(isValidId('')).toBe(false)
    })

    it('returns false for whitespace only', () => {
      expect(isValidId('   ')).toBe(false)
    })
  })
})

// ============================================================================
// 2. buildLookupQuery() Tests
// ============================================================================

describe('buildLookupQuery() - Build lookup filters', () => {
  describe('ID-based lookups', () => {
    it('returns { $id: "123" } for numeric ID "123"', () => {
      const query = buildLookupQuery('123', 'Customer')
      expect(query).toEqual({ $id: '123' })
    })

    it('returns { $id: "uuid-abc" } for UUID-like "uuid-abc"', () => {
      const query = buildLookupQuery('uuid-abc', 'Customer')
      expect(query).toEqual({ $id: 'uuid-abc' })
    })

    it('returns { $id } for standard ID format', () => {
      const query = buildLookupQuery('550e8400-e29b-41d4-a716-446655440000', 'Customer')
      expect(query.$id).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('preserves ID exactly as given', () => {
      const id = 'CUSTOM-ID-123'
      const query = buildLookupQuery(id, 'Customer')
      expect(query.$id).toBe(id)
    })
  })

  describe('Name-based lookups', () => {
    it('returns { name: "Alice" } for name "Alice"', () => {
      const query = buildLookupQuery('Alice', 'Customer')
      expect(query).toEqual({ name: 'Alice' })
    })

    it('returns { name: "Bob" } for name "Bob"', () => {
      const query = buildLookupQuery('Bob', 'Customer')
      expect(query).toEqual({ name: 'Bob' })
    })

    it('returns { name } for plain name values', () => {
      const query = buildLookupQuery('charlie', 'Customer')
      expect(query.name).toBe('charlie')
    })

    it('uses lowercase name field key', () => {
      const query = buildLookupQuery('TestName', 'Customer')
      expect(Object.keys(query)).toContain('name')
      expect(Object.keys(query)).not.toContain('Name')
    })
  })

  describe('Type parameter usage', () => {
    it('accepts Customer type', () => {
      const query = buildLookupQuery('Alice', 'Customer')
      expect(query).toBeDefined()
    })

    it('accepts Product type', () => {
      const query = buildLookupQuery('123', 'Product')
      expect(query).toBeDefined()
    })

    it('accepts Order type', () => {
      const query = buildLookupQuery('ORD-456', 'Order')
      expect(query).toBeDefined()
    })

    it('is case-insensitive for type', () => {
      const query1 = buildLookupQuery('Alice', 'Customer')
      const query2 = buildLookupQuery('Alice', 'customer')
      // Both should produce valid queries
      expect(query1).toBeDefined()
      expect(query2).toBeDefined()
    })
  })

  describe('Edge cases', () => {
    it('handles numeric-looking names carefully (fallback to ID)', () => {
      // "000123" should be treated as ID (all numeric)
      const query = buildLookupQuery('000123', 'Customer')
      expect(query.$id).toBe('000123')
    })

    it('handles empty lookup gracefully', () => {
      // Implementation should handle gracefully, not crash
      expect(() => buildLookupQuery('', 'Customer')).not.toThrow()
    })
  })
})

// ============================================================================
// 3. Integration Tests - Flexible GET Endpoint
// ============================================================================

describe('Flexible GET /api/:type/:lookup Integration', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /customers/:lookup by ID', () => {
    beforeEach(() => {
      const testCustomer: Customer = {
        $id: '123',
        name: 'Alice Johnson',
        email: 'alice@example.com',
      }

      mockDb.query.customers.findFirst.mockResolvedValue(testCustomer)
      app = createTestApp()
    })

    it('finds customer by numeric ID', async () => {
      const res = await app.request('/api/customers/123', { method: 'GET' })

      // Should call database with ID lookup
      expect(mockDb.query.customers.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            $id: '123',
          }),
        })
      )
    })

    it('finds customer by UUID', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000'
      const res = await app.request(`/api/customers/${uuidId}`, { method: 'GET' })

      expect(mockDb.query.customers.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            $id: uuidId,
          }),
        })
      )
    })
  })

  describe('GET /customers/:lookup by name', () => {
    beforeEach(() => {
      const aliceCustomer: Customer = {
        $id: 'cust-456',
        name: 'Alice',
        email: 'alice@example.com',
      }

      mockDb.query.customers.findFirst.mockResolvedValue(aliceCustomer)
      app = createTestApp()
    })

    it('finds customer by name "Alice"', async () => {
      const res = await app.request('/api/customers/Alice', { method: 'GET' })

      // Should call database with name lookup, NOT ID lookup
      expect(mockDb.query.customers.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: 'Alice',
          }),
        })
      )

      // Should NOT have looked up by $id
      const calls = mockDb.query.customers.findFirst.mock.calls
      const lastCall = calls[calls.length - 1][0] as { where: LookupQuery }
      expect(lastCall.where.$id).toBeUndefined()
    })

    it('returns customer with matching name', async () => {
      const res = await app.request('/api/customers/Alice', { method: 'GET' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as Customer
      expect(body.name).toBe('Alice')
    })

    it('distinguishes "Alice" (name) from "123" (ID)', async () => {
      // First call: lookup by ID
      await app.request('/api/customers/123', { method: 'GET' })
      const firstCall = mockDb.query.customers.findFirst.mock.calls[0][0]

      vi.clearAllMocks()
      mockDb.query.customers.findFirst.mockResolvedValue({
        $id: 'cust-789',
        name: 'Alice',
      })

      // Second call: lookup by name
      await app.request('/api/customers/Alice', { method: 'GET' })
      const secondCall = mockDb.query.customers.findFirst.mock.calls[0][0]

      // Verify they used different query strategies
      expect((firstCall as { where: LookupQuery }).where.$id).toBeDefined()
      expect((secondCall as { where: LookupQuery }).where.name).toBeDefined()
    })
  })

  describe('NOT found behavior', () => {
    beforeEach(() => {
      mockDb.query.customers.findFirst.mockResolvedValue(null)
      app = createTestApp()
    })

    it('returns 404 when customer not found by ID', async () => {
      const res = await app.request('/api/customers/999', { method: 'GET' })
      expect(res.status).toBe(404)
    })

    it('returns 404 when customer not found by name', async () => {
      const res = await app.request('/api/customers/NonExistent', { method: 'GET' })
      expect(res.status).toBe(404)
    })
  })
})

// ============================================================================
// 4. Decision Logic Tests
// ============================================================================

describe('ID vs Name Decision Logic', () => {
  it('numeric strings always treated as ID', () => {
    expect(buildLookupQuery('123', 'Customer')).toHaveProperty('$id')
    expect(buildLookupQuery('999', 'Customer')).toHaveProperty('$id')
  })

  it('alpha strings treated as name', () => {
    expect(buildLookupQuery('Alice', 'Customer')).toHaveProperty('name')
    expect(buildLookupQuery('Bob', 'Customer')).toHaveProperty('name')
  })

  it('hyphenated values treated as ID (UUID-like)', () => {
    expect(buildLookupQuery('abc-def-ghi', 'Customer')).toHaveProperty('$id')
    expect(buildLookupQuery('550e8400-e29b-41d4-a716-446655440000', 'Customer')).toHaveProperty('$id')
  })

  it('names with spaces treated as name', () => {
    expect(buildLookupQuery('John Doe', 'Customer')).toHaveProperty('name')
  })

  it('email-like strings treated as name', () => {
    expect(buildLookupQuery('user@example.com', 'Customer')).toHaveProperty('name')
  })
})
