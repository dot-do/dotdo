/**
 * RPC Linked Data Tests
 *
 * Tests for JSON-LD style linked data handling in RPC responses.
 * Covers:
 * - Linked data serialization ($context, $type, $id)
 * - Reference resolution (turning IDs into URLs)
 * - Circular reference handling
 * - Pagination with linked data
 * - Partial expansion (selective field inclusion)
 * - RPC response enrichment
 *
 * These tests verify that RPC responses include proper linked data
 * properties following JSON-LD conventions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildResponse, type ResponseOptions } from '../../../lib/response/linked-data'
import { buildCollectionResponse, type CollectionResponseOptions } from '../../../lib/response/collection'
import { buildRelationships, type RelationshipsOptions } from '../../../lib/response/relationships'
import { buildIdUrl, buildTypeUrl, normalizeNs, pluralize } from '../../../lib/response/urls'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const NS = 'https://headless.ly'
const CRM_NS = 'https://crm.example.org.ai/acme'

/**
 * Sample customer data for testing
 */
const sampleCustomer = {
  id: 'alice',
  name: 'Alice Smith',
  email: 'alice@example.com',
}

/**
 * Sample order data for testing
 */
const sampleOrder = {
  id: 'ord-123',
  total: 99.99,
  status: 'pending',
}

/**
 * Sample collection items
 */
const sampleCustomers = [
  { id: 'alice', name: 'Alice Smith' },
  { id: 'bob', name: 'Bob Jones' },
  { id: 'charlie', name: 'Charlie Brown' },
]

// ============================================================================
// LINKED DATA SERIALIZATION TESTS
// ============================================================================

describe('RPC Linked Data - Serialization', () => {
  describe('buildResponse adds $context, $type, $id', () => {
    it('adds linked data properties to single item', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.$context).toBe(NS)
      expect(result.$type).toBe(`${NS}/customers`)
      expect(result.$id).toBe(`${NS}/customers/alice`)
      expect(result.name).toBe('Alice Smith')
    })

    it('preserves all original data properties', () => {
      const result = buildResponse(
        { ...sampleCustomer, tags: ['vip'], metadata: { created: '2024-01-01' } },
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.name).toBe('Alice Smith')
      expect(result.email).toBe('alice@example.com')
      expect(result.tags).toEqual(['vip'])
      expect(result.metadata).toEqual({ created: '2024-01-01' })
    })

    it('handles nested objects correctly', () => {
      const result = buildResponse(
        {
          id: 'alice',
          profile: {
            address: { city: 'NYC', zip: '10001' },
            preferences: { theme: 'dark' },
          },
        },
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.profile).toEqual({
        address: { city: 'NYC', zip: '10001' },
        preferences: { theme: 'dark' },
      })
    })

    it('handles arrays in data', () => {
      const result = buildResponse(
        { id: 'alice', roles: ['admin', 'user'], scores: [85, 92, 78] },
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.roles).toEqual(['admin', 'user'])
      expect(result.scores).toEqual([85, 92, 78])
    })
  })

  describe('URL construction', () => {
    it('pluralizes type names correctly', () => {
      expect(pluralize('Customer')).toBe('customers')
      expect(pluralize('Person')).toBe('people')
      expect(pluralize('Category')).toBe('categories')
      expect(pluralize('Company')).toBe('companies')
      expect(pluralize('Box')).toBe('boxes')
    })

    it('builds type URLs with pluralized types', () => {
      expect(buildTypeUrl(NS, 'Customer')).toBe(`${NS}/customers`)
      expect(buildTypeUrl(NS, 'Order')).toBe(`${NS}/orders`)
      expect(buildTypeUrl(NS, 'Person')).toBe(`${NS}/people`)
    })

    it('builds ID URLs with encoded IDs', () => {
      expect(buildIdUrl(NS, 'Customer', 'alice')).toBe(`${NS}/customers/alice`)
      expect(buildIdUrl(NS, 'Customer', 'user@example.com')).toBe(`${NS}/customers/user%40example.com`)
      expect(buildIdUrl(NS, 'Customer', 'alice bob')).toBe(`${NS}/customers/alice%20bob`)
    })

    it('normalizes namespace by removing trailing slash', () => {
      expect(normalizeNs('https://example.com/')).toBe('https://example.com')
      expect(normalizeNs('https://example.com')).toBe('https://example.com')
    })
  })

  describe('collection responses', () => {
    it('adds linked data to collection', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        100,
        { ns: NS, type: 'Customer' }
      )

      expect(result.$context).toBe(NS)
      expect(result.$type).toBe(`${NS}/customers`)
      expect(result.$id).toBe(`${NS}/customers`)
      expect(result.count).toBe(100)
    })

    it('enriches collection items with linked data', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.items.length).toBe(3)

      const firstItem = result.items[0]!
      expect(firstItem.$context).toBe(NS)
      expect(firstItem.$type).toBe(`${NS}/customers`)
      expect(firstItem.$id).toBe(`${NS}/customers/alice`)
      expect(firstItem.name).toBe('Alice Smith')
    })

    it('includes navigation links in collection items', () => {
      const result = buildCollectionResponse(
        [sampleCustomers[0]!],
        1,
        { ns: NS, type: 'Customer' }
      )

      const item = result.items[0]!
      expect(item.links.self).toBe(`${NS}/customers/alice`)
    })
  })

  describe('root responses', () => {
    it('uses namespace as $type and $id for root', () => {
      const result = buildResponse(
        { name: 'My Startup' },
        { ns: NS, type: 'Startup', isRoot: true, parent: 'https://Startups.Studio' }
      )

      expect(result.$context).toBe('https://Startups.Studio')
      expect(result.$type).toBe(NS)
      expect(result.$id).toBe(NS)
    })

    it('falls back to schema.org.ai for orphan root', () => {
      const result = buildResponse(
        { name: 'Orphan Entity' },
        { ns: NS, type: 'Root', isRoot: true }
      )

      expect(result.$context).toBe('https://schema.org.ai/Root')
    })
  })
})

// ============================================================================
// REFERENCE RESOLUTION TESTS
// ============================================================================

describe('RPC Linked Data - Reference Resolution', () => {
  describe('buildRelationships converts IDs to URLs', () => {
    it('resolves single relationship ID to URL', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships?.worksAt).toBe(`${NS}/companies/acme`)
    })

    it('resolves array of relationship IDs to URLs', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'jane',
        relationships: { manages: ['bob', 'alice', 'charlie'] },
      })

      expect(result.relationships?.manages).toEqual([
        `${NS}/contacts/bob`,
        `${NS}/contacts/alice`,
        `${NS}/contacts/charlie`,
      ])
    })

    it('resolves references (reverse relationships)', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        references: { managedBy: 'jane' },
      })

      expect(result.references?.managedBy).toBe(`${NS}/contacts/jane`)
    })

    it('infers target type from relationship verb', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',      // -> companies
          reportsTo: 'jane',    // -> contacts (same type)
          belongsTo: 'tech',    // -> categories
        },
      })

      expect(result.relationships?.worksAt).toContain('/companies/')
      expect(result.relationships?.reportsTo).toContain('/contacts/')
      expect(result.relationships?.belongsTo).toContain('/categories/')
    })

    it('handles mixed single and array relationships', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',
          manages: ['bob', 'alice'],
        },
        references: {
          managedBy: 'jane',
          mentorOf: ['dave', 'eve'],
        },
      })

      expect(typeof result.relationships?.worksAt).toBe('string')
      expect(Array.isArray(result.relationships?.manages)).toBe(true)
      expect(typeof result.references?.managedBy).toBe('string')
      expect(Array.isArray(result.references?.mentorOf)).toBe(true)
    })
  })

  describe('URL encoding in references', () => {
    it('URL-encodes special characters in target IDs', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme@corp.com' },
      })

      expect(result.relationships?.worksAt).toContain('%40')
    })

    it('URL-encodes spaces in target IDs', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme corp' },
      })

      expect(result.relationships?.worksAt).toContain('%20')
    })

    it('preserves hyphens and underscores', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme-corp_123' },
      })

      expect(result.relationships?.worksAt).toBe(`${NS}/companies/acme-corp_123`)
    })
  })
})

// ============================================================================
// CIRCULAR REFERENCE HANDLING TESTS
// ============================================================================

describe('RPC Linked Data - Circular Reference Handling', () => {
  describe('self-referential relationships', () => {
    it('handles entity referencing itself', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { linkedTo: 'john' },  // Self-reference
      })

      expect(result.relationships?.linkedTo).toBe(`${NS}/contacts/john`)
    })

    it('handles mutual references between entities', () => {
      const johnRelations = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { partner: 'jane' },
      })

      const janeRelations = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'jane',
        relationships: { partner: 'john' },
      })

      expect(johnRelations.relationships?.partner).toBe(`${NS}/contacts/jane`)
      expect(janeRelations.relationships?.partner).toBe(`${NS}/contacts/john`)
    })
  })

  describe('graph structures', () => {
    it('handles many-to-many relationships', () => {
      const projectRelations = buildRelationships({
        ns: NS,
        type: 'Project',
        id: 'proj-1',
        relationships: {
          members: ['alice', 'bob', 'charlie'],
        },
      })

      const aliceRelations = buildRelationships({
        ns: NS,
        type: 'Person',
        id: 'alice',
        relationships: {
          projects: ['proj-1', 'proj-2'],
        },
      })

      expect(projectRelations.relationships?.members).toHaveLength(3)
      expect(aliceRelations.relationships?.projects).toHaveLength(2)
    })

    it('handles hierarchical relationships (parent-child)', () => {
      const parentRelations = buildRelationships({
        ns: NS,
        type: 'Category',
        id: 'electronics',
        relationships: {
          children: ['phones', 'laptops', 'tablets'],
        },
        references: {
          parent: 'root',
        },
      })

      expect(parentRelations.relationships?.children).toHaveLength(3)
      expect(parentRelations.references?.parent).toBe(`${NS}/categories/root`)
    })
  })

  describe('deep nesting prevention', () => {
    it('linked data properties are flat URLs, not nested objects', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: {
          manager: 'jane',
          team: ['bob', 'alice'],
        },
      })

      // Relationships should be URLs, not nested objects
      expect(typeof result.relationships?.manager).toBe('string')
      expect(result.relationships?.manager).toMatch(/^https?:\/\//)

      const team = result.relationships?.team as string[]
      team.forEach(url => {
        expect(typeof url).toBe('string')
        expect(url).toMatch(/^https?:\/\//)
      })
    })
  })
})

// ============================================================================
// PAGINATION WITH LINKED DATA TESTS
// ============================================================================

describe('RPC Linked Data - Pagination', () => {
  describe('collection pagination links', () => {
    it('includes next link when hasNext is true', () => {
      const result = buildCollectionResponse(
        sampleCustomers.slice(0, 2),
        100,
        {
          ns: NS,
          type: 'Customer',
          pagination: {
            hasNext: true,
            after: 'cursor-abc',
          },
        }
      )

      expect(result.links.next).toBe(`${NS}/customers?after=cursor-abc`)
    })

    it('includes prev link when hasPrev is true', () => {
      const result = buildCollectionResponse(
        sampleCustomers.slice(1, 3),
        100,
        {
          ns: NS,
          type: 'Customer',
          pagination: {
            hasPrev: true,
            before: 'cursor-xyz',
          },
        }
      )

      expect(result.links.prev).toBe(`${NS}/customers?before=cursor-xyz`)
    })

    it('includes both next and prev for middle pages', () => {
      const result = buildCollectionResponse(
        sampleCustomers.slice(1, 2),
        100,
        {
          ns: NS,
          type: 'Customer',
          pagination: {
            hasNext: true,
            hasPrev: true,
            after: 'next-cursor',
            before: 'prev-cursor',
          },
        }
      )

      expect(result.links.next).toBeDefined()
      expect(result.links.prev).toBeDefined()
    })

    it('includes first and self links always', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.links.self).toBe(`${NS}/customers`)
      expect(result.links.first).toBe(`${NS}/customers`)
    })

    it('includes home link pointing to namespace root', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.links.home).toBe(NS)
    })

    it('URL-encodes cursor values in pagination links', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        100,
        {
          ns: NS,
          type: 'Customer',
          pagination: {
            hasNext: true,
            after: 'cursor with spaces',
          },
        }
      )

      expect(result.links.next).toContain('cursor%20with%20spaces')
    })
  })

  describe('paginated items retain linked data', () => {
    it('each page item has $context, $type, $id', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        100,
        {
          ns: NS,
          type: 'Customer',
          pagination: { hasNext: true, after: 'cursor' },
        }
      )

      result.items.forEach(item => {
        expect(item.$context).toBe(NS)
        expect(item.$type).toBe(`${NS}/customers`)
        expect(item.$id).toMatch(new RegExp(`^${NS}/customers/`))
      })
    })
  })
})

// ============================================================================
// PARTIAL EXPANSION TESTS
// ============================================================================

describe('RPC Linked Data - Partial Expansion', () => {
  describe('selective field inclusion', () => {
    it('buildResponse includes all provided fields', () => {
      const fullData = {
        id: 'alice',
        name: 'Alice',
        email: 'alice@example.com',
        phone: '+1-555-0123',
        address: { city: 'NYC' },
      }

      const result = buildResponse(fullData, { ns: NS, type: 'Customer', id: 'alice' })

      expect(result.id).toBe('alice')
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
      expect(result.phone).toBe('+1-555-0123')
      expect(result.address).toEqual({ city: 'NYC' })
    })

    it('can build response with minimal fields', () => {
      const minimalData = { id: 'alice', name: 'Alice' }

      const result = buildResponse(minimalData, { ns: NS, type: 'Customer', id: 'alice' })

      expect(result.id).toBe('alice')
      expect(result.name).toBe('Alice')
      expect(result.$context).toBeDefined()
      expect(result.$type).toBeDefined()
      expect(result.$id).toBeDefined()
    })

    it('can build response with empty data object', () => {
      const result = buildResponse({}, { ns: NS, type: 'Customer', id: 'alice' })

      expect(result.$context).toBe(NS)
      expect(result.$type).toBe(`${NS}/customers`)
      expect(result.$id).toBe(`${NS}/customers/alice`)
      expect(Object.keys(result)).toEqual(['$context', '$type', '$id'])
    })
  })

  describe('relationships as expansion', () => {
    it('returns empty object when no relationships provided', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
      })

      expect(result).toEqual({})
    })

    it('returns only relationships when no references provided', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships).toBeDefined()
      expect(result.references).toBeUndefined()
    })

    it('returns only references when no relationships provided', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        references: { managedBy: 'jane' },
      })

      expect(result.relationships).toBeUndefined()
      expect(result.references).toBeDefined()
    })
  })
})

// ============================================================================
// RPC RESPONSE ENRICHMENT TESTS
// ============================================================================

describe('RPC Linked Data - Response Enrichment', () => {
  describe('enriching RPC method results', () => {
    it('can combine data with linked data properties', () => {
      // Simulate an RPC method returning raw data
      const rawResult = { id: 'alice', name: 'Alice Smith' }

      // Enrich with linked data
      const enriched = buildResponse(rawResult, {
        ns: NS,
        type: 'Customer',
        id: rawResult.id,
      })

      expect(enriched.id).toBe('alice')
      expect(enriched.name).toBe('Alice Smith')
      expect(enriched.$context).toBe(NS)
      expect(enriched.$type).toBe(`${NS}/customers`)
      expect(enriched.$id).toBe(`${NS}/customers/alice`)
    })

    it('can enrich collection results', () => {
      // Simulate collection method returning raw data
      const rawItems = [
        { id: 'alice', name: 'Alice' },
        { id: 'bob', name: 'Bob' },
      ]

      // Enrich with linked data
      const enriched = buildCollectionResponse(rawItems, 2, {
        ns: NS,
        type: 'Customer',
      })

      expect(enriched.$context).toBe(NS)
      expect(enriched.items.length).toBe(2)
      expect(enriched.items[0]!.$id).toBe(`${NS}/customers/alice`)
      expect(enriched.items[1]!.$id).toBe(`${NS}/customers/bob`)
    })

    it('can add relationships to enriched response', () => {
      const rawResult = { id: 'john', name: 'John' }

      const linkedData = buildResponse(rawResult, {
        ns: NS,
        type: 'Contact',
        id: rawResult.id,
      })

      const relationships = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: rawResult.id,
        relationships: { worksAt: 'acme' },
      })

      // Combine into final response
      const enriched = {
        ...linkedData,
        ...relationships,
      }

      expect(enriched.$id).toBe(`${NS}/contacts/john`)
      expect(enriched.relationships?.worksAt).toBe(`${NS}/companies/acme`)
    })
  })

  describe('parent context for nested resources', () => {
    it('uses parent URL as context for nested collection', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        10,
        {
          ns: NS,
          type: 'Order',
          parent: `${NS}/customers/alice`,
        }
      )

      expect(result.$context).toBe(`${NS}/customers/alice`)
      expect(result.$type).toBe(`${NS}/customers/alice/orders`)
    })

    it('builds correct item URLs for nested resources', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-123', total: 99.99 }],
        1,
        {
          ns: NS,
          type: 'Order',
          parent: `${NS}/customers/alice`,
        }
      )

      expect(result.items[0]!.$id).toBe(`${NS}/customers/alice/orders/ord-123`)
    })
  })

  describe('collection actions', () => {
    it('includes create action for collections', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.actions.create).toEqual({
        method: 'POST',
        href: `${NS}/customers`,
      })
    })

    it('includes custom actions when specified', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        {
          ns: NS,
          type: 'Customer',
          customActions: ['import', 'export'],
        }
      )

      expect(result.actions.import).toEqual({
        method: 'POST',
        href: `${NS}/customers/import`,
      })
      expect(result.actions.export).toEqual({
        method: 'POST',
        href: `${NS}/customers/export`,
      })
    })
  })

  describe('facets in collection responses', () => {
    it('includes facets when provided', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        {
          ns: NS,
          type: 'Customer',
          facets: {
            sort: ['name', 'createdAt'],
            filter: { status: ['active', 'pending', 'closed'] },
          },
        }
      )

      expect(result.facets?.sort).toEqual(['name', 'createdAt'])
      expect(result.facets?.filter?.status).toEqual(['active', 'pending', 'closed'])
    })

    it('omits facets when not provided', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.facets).toBeUndefined()
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - URL CONSISTENCY
// ============================================================================

describe('RPC Linked Data - URL Consistency', () => {
  describe('URL hierarchy', () => {
    it('$id starts with $type for item responses', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.$id.startsWith(result.$type)).toBe(true)
    })

    it('$type starts with $context for non-root responses', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.$type.startsWith(result.$context)).toBe(true)
    })

    it('$id equals $type for collection responses', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.$id).toBe(result.$type)
    })
  })

  describe('namespace variations', () => {
    it('handles namespace with port', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: 'https://localhost:8787', type: 'Customer', id: 'alice' }
      )

      expect(result.$type).toBe('https://localhost:8787/customers')
      expect(result.$id).toBe('https://localhost:8787/customers/alice')
    })

    it('handles namespace with path segments', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: 'https://api.example.com/v1/tenant', type: 'Customer', id: 'alice' }
      )

      expect(result.$type).toBe('https://api.example.com/v1/tenant/customers')
    })

    it('normalizes namespace with trailing slash', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: 'https://headless.ly/', type: 'Customer', id: 'alice' }
      )

      expect(result.$type).toBe('https://headless.ly/customers')
      // Ensure no double slashes in the path portion (after protocol)
      const pathPortion = result.$type.replace(/^https?:\/\//, '')
      expect(pathPortion).not.toContain('//')
    })
  })

  describe('all URLs are fully qualified', () => {
    it('item response URLs start with https://', () => {
      const result = buildResponse(
        sampleCustomer,
        { ns: NS, type: 'Customer', id: 'alice' }
      )

      expect(result.$context).toMatch(/^https?:\/\//)
      expect(result.$type).toMatch(/^https?:\/\//)
      expect(result.$id).toMatch(/^https?:\/\//)
    })

    it('collection response URLs start with https://', () => {
      const result = buildCollectionResponse(
        sampleCustomers,
        3,
        { ns: NS, type: 'Customer' }
      )

      expect(result.$context).toMatch(/^https?:\/\//)
      expect(result.$type).toMatch(/^https?:\/\//)
      expect(result.$id).toMatch(/^https?:\/\//)
      expect(result.links.self).toMatch(/^https?:\/\//)
    })

    it('relationship URLs start with https://', () => {
      const result = buildRelationships({
        ns: NS,
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme', manages: ['bob', 'alice'] },
      })

      expect(result.relationships?.worksAt).toMatch(/^https?:\/\//)
      const manages = result.relationships?.manages as string[]
      manages.forEach(url => expect(url).toMatch(/^https?:\/\//))
    })
  })
})

// ============================================================================
// REAL-WORLD SCENARIO TESTS
// ============================================================================

describe('RPC Linked Data - Real-World Scenarios', () => {
  it('CRM contact with full linked data', () => {
    const contactData = {
      id: 'john-doe',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@acme.com',
      phone: '+1-555-0123',
    }

    const linkedData = buildResponse(contactData, {
      ns: CRM_NS,
      type: 'Contact',
      id: contactData.id,
    })

    const relationships = buildRelationships({
      ns: CRM_NS,
      type: 'Contact',
      id: contactData.id,
      relationships: {
        worksAt: 'acme-corp',
        manages: ['bob-smith', 'alice-jones'],
      },
      references: {
        managedBy: 'jane-manager',
      },
    })

    const enriched = { ...linkedData, ...relationships }

    expect(enriched.$context).toBe(CRM_NS)
    expect(enriched.$type).toBe(`${CRM_NS}/contacts`)
    expect(enriched.$id).toBe(`${CRM_NS}/contacts/john-doe`)
    expect(enriched.firstName).toBe('John')
    expect(enriched.relationships?.worksAt).toBe(`${CRM_NS}/companies/acme-corp`)
    expect(enriched.references?.managedBy).toBe(`${CRM_NS}/contacts/jane-manager`)
  })

  it('E-commerce paginated product catalog', () => {
    const products = [
      { id: 'prod-1', name: 'Widget A', price: 19.99 },
      { id: 'prod-2', name: 'Widget B', price: 29.99 },
      { id: 'prod-3', name: 'Widget C', price: 39.99 },
    ]

    const result = buildCollectionResponse(products, 150, {
      ns: 'https://shop.example.com',
      type: 'Product',
      pagination: {
        hasNext: true,
        after: 'cursor-page-1',
      },
      facets: {
        sort: ['name', 'price', '-createdAt'],
        filter: {
          category: ['electronics', 'accessories'],
          inStock: ['true', 'false'],
        },
      },
    })

    expect(result.$type).toBe('https://shop.example.com/products')
    expect(result.count).toBe(150)
    expect(result.items.length).toBe(3)
    expect(result.links.next).toContain('cursor-page-1')
    expect(result.facets?.sort).toContain('price')
    expect(result.actions.create.href).toBe('https://shop.example.com/products')
  })

  it('Nested resource: customer orders', () => {
    const orders = [
      { id: 'ord-001', total: 99.99, status: 'shipped' },
      { id: 'ord-002', total: 149.99, status: 'pending' },
    ]

    const result = buildCollectionResponse(orders, 25, {
      ns: 'https://shop.example.com',
      type: 'Order',
      parent: 'https://shop.example.com/customers/alice',
    })

    expect(result.$context).toBe('https://shop.example.com/customers/alice')
    expect(result.$type).toBe('https://shop.example.com/customers/alice/orders')
    expect(result.items[0]!.$id).toBe('https://shop.example.com/customers/alice/orders/ord-001')
  })
})
