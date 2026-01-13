import { describe, it, expect } from 'vitest'

/**
 * Links Builder Tests (RED Phase)
 *
 * These tests verify the navigation link building utilities for constructing
 * HATEOAS-style links in API responses.
 *
 * They are expected to FAIL until lib/response/links.ts is implemented.
 *
 * Expected function signatures (to be implemented):
 *
 * interface ItemLinksOptions {
 *   ns: string           // Namespace URL (e.g., 'https://headless.ly')
 *   type: string         // Entity type (e.g., 'Customer')
 *   id: string           // Entity ID (e.g., 'alice')
 *   relations?: string[] // Related collections (e.g., ['orders', 'invoices'])
 * }
 *
 * interface CollectionLinksOptions {
 *   ns: string           // Namespace URL
 *   type: string         // Entity type
 *   pagination?: {
 *     after?: string     // Cursor for next page
 *     before?: string    // Cursor for previous page
 *     hasNext?: boolean  // Whether there's a next page
 *     hasPrev?: boolean  // Whether there's a previous page
 *   }
 * }
 *
 * export function buildItemLinks(options: ItemLinksOptions): Record<string, string>
 * export function buildCollectionLinks(options: CollectionLinksOptions): Record<string, string>
 *
 * Link Types:
 * - Item links: collection (back to list), edit (edit form URL)
 * - Collection links: home (namespace root), first (first page), next, prev, last
 * - Custom relation links: /:type/:id/:relation (e.g., /customers/alice/orders)
 *
 * All links MUST be fully qualified URLs (start with https://)
 */

// Import the module under test (will fail until implemented)
import { buildItemLinks, buildCollectionLinks } from '../links'

// ============================================================================
// buildItemLinks Tests
// ============================================================================

describe('buildItemLinks', () => {
  describe('basic item links', () => {
    it('returns collection link pointing to type collection', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      expect(result.collection).toBe('https://headless.ly/customers')
    })

    it('returns edit link pointing to item edit URL', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      expect(result.edit).toBe('https://headless.ly/customers/alice/edit')
    })

    it('includes both collection and edit links by default', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      expect(result).toEqual({
        collection: 'https://headless.ly/customers',
        edit: 'https://headless.ly/customers/alice/edit',
      })
    })
  })

  describe('type pluralization', () => {
    it('pluralizes regular nouns for collection link', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Product',
        id: 'widget-1',
      })

      expect(result.collection).toBe('https://headless.ly/products')
      expect(result.edit).toBe('https://headless.ly/products/widget-1/edit')
    })

    it('pluralizes nouns ending in y to ies', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Category',
        id: 'tech',
      })

      expect(result.collection).toBe('https://headless.ly/categories')
      expect(result.edit).toBe('https://headless.ly/categories/tech/edit')
    })

    it('pluralizes nouns ending in s to ses', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Status',
        id: 'active',
      })

      expect(result.collection).toBe('https://headless.ly/statuses')
    })

    it('handles irregular plurals - Person to people', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Person',
        id: 'john',
      })

      expect(result.collection).toBe('https://headless.ly/people')
      expect(result.edit).toBe('https://headless.ly/people/john/edit')
    })
  })

  describe('relation links', () => {
    it('includes single relation link when relations provided', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        relations: ['orders'],
      })

      expect(result.orders).toBe('https://headless.ly/customers/alice/orders')
    })

    it('includes multiple relation links', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        relations: ['orders', 'invoices'],
      })

      expect(result.orders).toBe('https://headless.ly/customers/alice/orders')
      expect(result.invoices).toBe('https://headless.ly/customers/alice/invoices')
    })

    it('includes all standard links plus relations', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        relations: ['orders'],
      })

      expect(result).toEqual({
        collection: 'https://headless.ly/customers',
        edit: 'https://headless.ly/customers/alice/edit',
        orders: 'https://headless.ly/customers/alice/orders',
      })
    })

    it('handles relation with hyphenated name', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        relations: ['payment-methods'],
      })

      expect(result['payment-methods']).toBe('https://headless.ly/customers/alice/payment-methods')
    })

    it('handles empty relations array', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        relations: [],
      })

      expect(result).toEqual({
        collection: 'https://headless.ly/customers',
        edit: 'https://headless.ly/customers/alice/edit',
      })
    })
  })

  describe('namespace handling', () => {
    it('handles namespace with path', () => {
      const result = buildItemLinks({
        ns: 'https://crm.example.org.ai/acme',
        type: 'Contact',
        id: 'ord-123',
      })

      expect(result.collection).toBe('https://crm.example.org.ai/acme/contacts')
      expect(result.edit).toBe('https://crm.example.org.ai/acme/contacts/ord-123/edit')
    })

    it('handles namespace with trailing slash', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly/',
        type: 'Customer',
        id: 'alice',
      })

      // Should not double up slashes
      expect(result.collection).toBe('https://headless.ly/customers')
      expect(result.edit).toBe('https://headless.ly/customers/alice/edit')
    })

    it('handles namespace with port', () => {
      const result = buildItemLinks({
        ns: 'https://localhost:8787',
        type: 'Customer',
        id: 'alice',
      })

      expect(result.collection).toBe('https://localhost:8787/customers')
      expect(result.edit).toBe('https://localhost:8787/customers/alice/edit')
    })
  })

  describe('URL encoding', () => {
    it('URL-encodes special characters in id', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'user@example.com',
      })

      expect(result.edit).toBe('https://headless.ly/customers/user%40example.com/edit')
    })

    it('URL-encodes spaces in id', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice bob',
      })

      expect(result.edit).toBe('https://headless.ly/customers/alice%20bob/edit')
    })

    it('preserves hyphens and underscores in id', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice-bob_123',
      })

      expect(result.edit).toBe('https://headless.ly/customers/alice-bob_123/edit')
    })
  })

  describe('fully qualified URLs', () => {
    it('all links are fully qualified URLs', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        relations: ['orders'],
      })

      // All links must start with https://
      Object.values(result).forEach((url) => {
        expect(url).toMatch(/^https?:\/\//)
      })
    })

    it('preserves original protocol from namespace', () => {
      const result = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      expect(result.collection).toMatch(/^https:\/\//)
      expect(result.edit).toMatch(/^https:\/\//)
    })
  })
})

// ============================================================================
// buildCollectionLinks Tests
// ============================================================================

describe('buildCollectionLinks', () => {
  describe('basic collection links', () => {
    it('returns home link pointing to namespace', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(result.home).toBe('https://headless.ly')
    })

    it('returns first link pointing to collection without pagination', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(result.first).toBe('https://headless.ly/customers')
    })

    it('includes home and first links by default', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(result.home).toBe('https://headless.ly')
      expect(result.first).toBe('https://headless.ly/customers')
    })
  })

  describe('pagination links with after cursor', () => {
    it('returns next link with after param when hasNext is true', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'xyz',
          hasNext: true,
        },
      })

      expect(result.next).toBe('https://headless.ly/customers?after=xyz')
    })

    it('omits next link when hasNext is false', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'xyz',
          hasNext: false,
        },
      })

      expect(result.next).toBeUndefined()
    })

    it('omits next link when after is provided but hasNext is undefined', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'xyz',
        },
      })

      expect(result.next).toBeUndefined()
    })
  })

  describe('pagination links with before cursor', () => {
    it('returns prev link with before param when hasPrev is true', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          before: 'abc',
          hasPrev: true,
        },
      })

      expect(result.prev).toBe('https://headless.ly/customers?before=abc')
    })

    it('omits prev link when hasPrev is false', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          before: 'abc',
          hasPrev: false,
        },
      })

      expect(result.prev).toBeUndefined()
    })

    it('omits prev link when before is provided but hasPrev is undefined', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          before: 'abc',
        },
      })

      expect(result.prev).toBeUndefined()
    })
  })

  describe('bidirectional pagination', () => {
    it('returns both next and prev links when both cursors present', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'next-cursor',
          before: 'prev-cursor',
          hasNext: true,
          hasPrev: true,
        },
      })

      expect(result.next).toBe('https://headless.ly/customers?after=next-cursor')
      expect(result.prev).toBe('https://headless.ly/customers?before=prev-cursor')
    })

    it('includes home, first, next, and prev in full response', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'next-cursor',
          before: 'prev-cursor',
          hasNext: true,
          hasPrev: true,
        },
      })

      expect(result).toEqual({
        home: 'https://headless.ly',
        first: 'https://headless.ly/customers',
        next: 'https://headless.ly/customers?after=next-cursor',
        prev: 'https://headless.ly/customers?before=prev-cursor',
      })
    })
  })

  describe('last link', () => {
    it('omits last link by default (not supported in cursor pagination)', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(result.last).toBeUndefined()
    })

    it('omits last link even with pagination present', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'xyz',
          hasNext: true,
        },
      })

      // Cursor-based pagination typically doesn't support "last" efficiently
      expect(result.last).toBeUndefined()
    })
  })

  describe('type pluralization', () => {
    it('pluralizes type for first link', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Category',
      })

      expect(result.first).toBe('https://headless.ly/categories')
    })

    it('pluralizes type in pagination links', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Status',
        pagination: {
          after: 'xyz',
          hasNext: true,
        },
      })

      expect(result.first).toBe('https://headless.ly/statuses')
      expect(result.next).toBe('https://headless.ly/statuses?after=xyz')
    })

    it('handles irregular plurals', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Person',
        pagination: {
          before: 'abc',
          hasPrev: true,
        },
      })

      expect(result.first).toBe('https://headless.ly/people')
      expect(result.prev).toBe('https://headless.ly/people?before=abc')
    })
  })

  describe('namespace handling', () => {
    it('handles namespace with path', () => {
      const result = buildCollectionLinks({
        ns: 'https://crm.example.org.ai/acme',
        type: 'Contact',
      })

      expect(result.home).toBe('https://crm.example.org.ai/acme')
      expect(result.first).toBe('https://crm.example.org.ai/acme/contacts')
    })

    it('handles namespace with trailing slash', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly/',
        type: 'Customer',
      })

      // Should not double up slashes
      expect(result.first).toBe('https://headless.ly/customers')
    })

    it('handles namespace with port', () => {
      const result = buildCollectionLinks({
        ns: 'https://localhost:8787',
        type: 'Customer',
      })

      expect(result.home).toBe('https://localhost:8787')
      expect(result.first).toBe('https://localhost:8787/customers')
    })

    it('preserves home link trailing slash from namespace', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly/',
        type: 'Customer',
      })

      // Home should preserve original namespace format
      expect(result.home).toBe('https://headless.ly/')
    })
  })

  describe('cursor URL encoding', () => {
    it('URL-encodes special characters in after cursor', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'foo=bar&baz',
          hasNext: true,
        },
      })

      expect(result.next).toBe('https://headless.ly/customers?after=foo%3Dbar%26baz')
    })

    it('URL-encodes special characters in before cursor', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          before: 'a+b c',
          hasPrev: true,
        },
      })

      expect(result.prev).toBe('https://headless.ly/customers?before=a%2Bb%20c')
    })

    it('handles base64-like cursors', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'eyJpZCI6ImFsaWNlIiwidHMiOjE3MDAwMDB9',
          hasNext: true,
        },
      })

      // Base64 characters should be preserved (alphanumeric)
      expect(result.next).toBe('https://headless.ly/customers?after=eyJpZCI6ImFsaWNlIiwidHMiOjE3MDAwMDB9')
    })
  })

  describe('fully qualified URLs', () => {
    it('all links are fully qualified URLs', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {
          after: 'xyz',
          before: 'abc',
          hasNext: true,
          hasPrev: true,
        },
      })

      // All links must start with https://
      Object.values(result).forEach((url) => {
        expect(url).toMatch(/^https?:\/\//)
      })
    })

    it('preserves original protocol from namespace', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(result.home).toMatch(/^https:\/\//)
      expect(result.first).toMatch(/^https:\/\//)
    })
  })

  describe('no pagination', () => {
    it('returns only home and first when no pagination provided', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(Object.keys(result)).toEqual(['home', 'first'])
    })

    it('returns only home and first when pagination is empty object', () => {
      const result = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        pagination: {},
      })

      expect(Object.keys(result)).toEqual(['home', 'first'])
    })
  })
})

// ============================================================================
// Integration Tests - URL Consistency
// ============================================================================

describe('links URL consistency', () => {
  describe('item links consistency', () => {
    it('collection link matches buildCollectionLinks first link', () => {
      const itemLinks = buildItemLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      const collectionLinks = buildCollectionLinks({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(itemLinks.collection).toBe(collectionLinks.first)
    })
  })

  describe('real-world namespace examples', () => {
    it('headless.ly namespace produces valid item links', () => {
      const ns = 'https://headless.ly'

      const result = buildItemLinks({ ns, type: 'Customer', id: 'alice' })

      expect(result).toEqual({
        collection: 'https://headless.ly/customers',
        edit: 'https://headless.ly/customers/alice/edit',
      })
    })

    it('headless.ly namespace produces valid collection links', () => {
      const ns = 'https://headless.ly'

      const result = buildCollectionLinks({
        ns,
        type: 'Customer',
        pagination: { after: 'xyz', hasNext: true },
      })

      expect(result).toEqual({
        home: 'https://headless.ly',
        first: 'https://headless.ly/customers',
        next: 'https://headless.ly/customers?after=xyz',
      })
    })

    it('CRM example namespace produces valid links', () => {
      const ns = 'https://crm.example.org.ai/acme'

      const itemResult = buildItemLinks({ ns, type: 'Contact', id: 'ord-123', relations: ['deals'] })
      const collectionResult = buildCollectionLinks({ ns, type: 'Contact' })

      expect(itemResult.collection).toBe('https://crm.example.org.ai/acme/contacts')
      expect(itemResult.deals).toBe('https://crm.example.org.ai/acme/contacts/ord-123/deals')
      expect(collectionResult.home).toBe('https://crm.example.org.ai/acme')
    })

    it('Startups.Studio namespace produces valid links', () => {
      const ns = 'https://Startups.Studio'

      const result = buildItemLinks({ ns, type: 'Deal', id: 'acme' })

      expect(result).toEqual({
        collection: 'https://Startups.Studio/deals',
        edit: 'https://Startups.Studio/deals/acme/edit',
      })
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('buildItemLinks returns Record<string, string>', () => {
    const result: Record<string, string> = buildItemLinks({
      ns: 'https://headless.ly',
      type: 'Customer',
      id: 'alice',
    })

    expect(typeof result).toBe('object')
    Object.values(result).forEach((value) => {
      expect(typeof value).toBe('string')
    })
  })

  it('buildCollectionLinks returns Record<string, string>', () => {
    const result: Record<string, string> = buildCollectionLinks({
      ns: 'https://headless.ly',
      type: 'Customer',
    })

    expect(typeof result).toBe('object')
    Object.values(result).forEach((value) => {
      expect(typeof value).toBe('string')
    })
  })

  it('buildItemLinks accepts relations as string array', () => {
    const relations: string[] = ['orders', 'invoices']

    const result = buildItemLinks({
      ns: 'https://headless.ly',
      type: 'Customer',
      id: 'alice',
      relations,
    })

    expect(result.orders).toBeDefined()
    expect(result.invoices).toBeDefined()
  })

  it('buildCollectionLinks accepts pagination object', () => {
    const pagination = {
      after: 'cursor',
      hasNext: true,
    }

    const result = buildCollectionLinks({
      ns: 'https://headless.ly',
      type: 'Customer',
      pagination,
    })

    expect(result.next).toBeDefined()
  })
})
