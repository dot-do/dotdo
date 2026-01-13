import { describe, it, expect } from 'vitest'

/**
 * Relationships Builder Tests (RED Phase)
 *
 * These tests verify the relationship building utilities for constructing
 * relationship and reference links in API responses. Relationships show
 * how items connect to other items - forward relationships (from this item)
 * and reverse references (to this item).
 *
 * They are expected to FAIL until lib/response/relationships.ts is implemented.
 *
 * Expected function signatures (to be implemented):
 *
 * interface RelationshipsOptions {
 *   ns: string                                       // Namespace URL (e.g., 'https://headless.ly')
 *   type: string                                     // Entity type (e.g., 'Contact')
 *   id: string                                       // Entity ID (e.g., 'john')
 *   relationships?: Record<string, string | string[]>  // verb -> target(s)
 *   references?: Record<string, string | string[]>     // reverse verb -> source(s)
 * }
 *
 * export function buildRelationships(options: RelationshipsOptions): {
 *   relationships?: Record<string, string | string[]>
 *   references?: Record<string, string | string[]>
 * }
 *
 * Relationship Types:
 * - Forward relationships: worksAt, manages, belongsTo, etc.
 * - Reverse references: managedBy, employeeOf, parentOf, etc.
 *
 * All relationship URLs MUST be fully qualified URLs (start with https://)
 */

// Import the module under test (will fail until implemented)
import { buildRelationships } from '../relationships'

// ============================================================================
// buildRelationships - Single Relationship Tests
// ============================================================================

describe('buildRelationships', () => {
  describe('single relationship as string', () => {
    it('converts single relationship to fully qualified URL', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships).toEqual({
        worksAt: 'https://headless.ly/companies/acme',
      })
    })

    it('handles multiple single relationships', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',
          reportsTo: 'jane',
        },
      })

      expect(result.relationships).toEqual({
        worksAt: 'https://headless.ly/companies/acme',
        reportsTo: 'https://headless.ly/contacts/jane',
      })
    })

    it('infers target type from relationship verb - worksAt implies companies', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships?.worksAt).toBe('https://headless.ly/companies/acme')
    })

    it('infers target type from relationship verb - reportsTo implies same type', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { reportsTo: 'jane' },
      })

      expect(result.relationships?.reportsTo).toBe('https://headless.ly/contacts/jane')
    })

    it('infers target type from relationship verb - manages implies same type', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'jane',
        relationships: { manages: 'john' },
      })

      expect(result.relationships?.manages).toBe('https://headless.ly/contacts/john')
    })
  })

  // ============================================================================
  // buildRelationships - Multiple Relationships (Array) Tests
  // ============================================================================

  describe('multiple relationships as array', () => {
    it('converts array of relationships to fully qualified URLs', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { manages: ['bob', 'alice', 'charlie'] },
      })

      expect(result.relationships).toEqual({
        manages: [
          'https://headless.ly/contacts/bob',
          'https://headless.ly/contacts/alice',
          'https://headless.ly/contacts/charlie',
        ],
      })
    })

    it('preserves array order', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { manages: ['alice', 'bob', 'charlie'] },
      })

      const manages = result.relationships?.manages as string[]
      expect(manages[0]).toBe('https://headless.ly/contacts/alice')
      expect(manages[1]).toBe('https://headless.ly/contacts/bob')
      expect(manages[2]).toBe('https://headless.ly/contacts/charlie')
    })

    it('handles empty array', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { manages: [] },
      })

      expect(result.relationships?.manages).toEqual([])
    })

    it('handles single item in array', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { manages: ['bob'] },
      })

      expect(result.relationships?.manages).toEqual(['https://headless.ly/contacts/bob'])
    })

    it('handles mixed single and array relationships', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',
          manages: ['bob', 'alice'],
        },
      })

      expect(result.relationships).toEqual({
        worksAt: 'https://headless.ly/companies/acme',
        manages: ['https://headless.ly/contacts/bob', 'https://headless.ly/contacts/alice'],
      })
    })
  })

  // ============================================================================
  // buildRelationships - Reverse References Tests
  // ============================================================================

  describe('reverse references', () => {
    it('converts single reference to fully qualified URL', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        references: { managedBy: 'jane' },
      })

      expect(result.references).toEqual({
        managedBy: 'https://headless.ly/contacts/jane',
      })
    })

    it('converts array of references to fully qualified URLs', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'jane',
        references: { managerOf: ['bob', 'alice', 'charlie'] },
      })

      expect(result.references).toEqual({
        managerOf: [
          'https://headless.ly/contacts/bob',
          'https://headless.ly/contacts/alice',
          'https://headless.ly/contacts/charlie',
        ],
      })
    })

    it('handles multiple reference types', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        references: {
          managedBy: 'jane',
          employeeOf: 'acme',
        },
      })

      expect(result.references).toEqual({
        managedBy: 'https://headless.ly/contacts/jane',
        employeeOf: 'https://headless.ly/companies/acme',
      })
    })

    it('infers source type from reference verb - managedBy implies same type', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'bob',
        references: { managedBy: 'jane' },
      })

      expect(result.references?.managedBy).toBe('https://headless.ly/contacts/jane')
    })

    it('infers source type from reference verb - employeeOf implies companies', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        references: { employeeOf: 'acme' },
      })

      expect(result.references?.employeeOf).toBe('https://headless.ly/companies/acme')
    })
  })

  // ============================================================================
  // buildRelationships - Combined Relationships and References
  // ============================================================================

  describe('combined relationships and references', () => {
    it('returns both relationships and references when provided', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
        references: { managedBy: 'jane' },
      })

      expect(result).toEqual({
        relationships: { worksAt: 'https://headless.ly/companies/acme' },
        references: { managedBy: 'https://headless.ly/contacts/jane' },
      })
    })

    it('returns only relationships when no references provided', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships).toBeDefined()
      expect(result.references).toBeUndefined()
    })

    it('returns only references when no relationships provided', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        references: { managedBy: 'jane' },
      })

      expect(result.relationships).toBeUndefined()
      expect(result.references).toBeDefined()
    })

    it('returns empty object when neither provided', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
      })

      expect(result).toEqual({})
    })

    it('handles complex graph of relationships', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',
          manages: ['bob', 'alice'],
          mentors: 'charlie',
        },
        references: {
          managedBy: 'jane',
          mentorOf: ['dave', 'eve'],
        },
      })

      expect(result).toEqual({
        relationships: {
          worksAt: 'https://headless.ly/companies/acme',
          manages: ['https://headless.ly/contacts/bob', 'https://headless.ly/contacts/alice'],
          mentors: 'https://headless.ly/contacts/charlie',
        },
        references: {
          managedBy: 'https://headless.ly/contacts/jane',
          mentorOf: ['https://headless.ly/contacts/dave', 'https://headless.ly/contacts/eve'],
        },
      })
    })
  })

  // ============================================================================
  // buildRelationships - URL Qualification Tests
  // ============================================================================

  describe('fully qualified URLs', () => {
    it('all relationship URLs are fully qualified', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',
          manages: ['bob', 'alice'],
        },
      })

      const worksAt = result.relationships?.worksAt as string
      expect(worksAt).toMatch(/^https?:\/\//)

      const manages = result.relationships?.manages as string[]
      manages.forEach((url) => {
        expect(url).toMatch(/^https?:\/\//)
      })
    })

    it('all reference URLs are fully qualified', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        references: {
          managedBy: 'jane',
          mentorOf: ['dave', 'eve'],
        },
      })

      const managedBy = result.references?.managedBy as string
      expect(managedBy).toMatch(/^https?:\/\//)

      const mentorOf = result.references?.mentorOf as string[]
      mentorOf.forEach((url) => {
        expect(url).toMatch(/^https?:\/\//)
      })
    })

    it('preserves protocol from namespace', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships?.worksAt).toMatch(/^https:\/\//)
    })
  })

  // ============================================================================
  // buildRelationships - Namespace Handling Tests
  // ============================================================================

  describe('namespace handling', () => {
    it('handles namespace with path', () => {
      const result = buildRelationships({
        ns: 'https://crm.example.org.ai/acme',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'corp' },
      })

      expect(result.relationships?.worksAt).toBe('https://crm.example.org.ai/acme/companies/corp')
    })

    it('handles namespace with trailing slash', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly/',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      // Should not double up slashes
      expect(result.relationships?.worksAt).toBe('https://headless.ly/companies/acme')
    })

    it('handles namespace with port', () => {
      const result = buildRelationships({
        ns: 'https://localhost:8787',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships?.worksAt).toBe('https://localhost:8787/companies/acme')
    })
  })

  // ============================================================================
  // buildRelationships - Type Pluralization Tests
  // ============================================================================

  describe('type pluralization in URLs', () => {
    it('pluralizes target type in relationship URLs', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { manages: 'bob' },
      })

      // Contact -> contacts
      expect(result.relationships?.manages).toBe('https://headless.ly/contacts/bob')
    })

    it('pluralizes company to companies', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      // Company -> companies
      expect(result.relationships?.worksAt).toBe('https://headless.ly/companies/acme')
    })

    it('handles irregular plurals - Person to people', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Person',
        id: 'john',
        relationships: { knows: 'jane' },
      })

      // Person -> people
      expect(result.relationships?.knows).toBe('https://headless.ly/people/jane')
    })

    it('pluralizes nouns ending in y to ies', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { belongsTo: 'tech' }, // Category -> categories
      })

      expect(result.relationships?.belongsTo).toBe('https://headless.ly/categories/tech')
    })
  })

  // ============================================================================
  // buildRelationships - URL Encoding Tests
  // ============================================================================

  describe('URL encoding', () => {
    it('URL-encodes special characters in target IDs', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme@corp.com' },
      })

      expect(result.relationships?.worksAt).toBe('https://headless.ly/companies/acme%40corp.com')
    })

    it('URL-encodes spaces in target IDs', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme corp' },
      })

      expect(result.relationships?.worksAt).toBe('https://headless.ly/companies/acme%20corp')
    })

    it('preserves hyphens and underscores in target IDs', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme-corp_123' },
      })

      expect(result.relationships?.worksAt).toBe('https://headless.ly/companies/acme-corp_123')
    })

    it('URL-encodes array values', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { manages: ['bob@acme.com', 'alice smith'] },
      })

      const manages = result.relationships?.manages as string[]
      expect(manages[0]).toBe('https://headless.ly/contacts/bob%40acme.com')
      expect(manages[1]).toBe('https://headless.ly/contacts/alice%20smith')
    })
  })

  // ============================================================================
  // buildRelationships - Real-World Examples
  // ============================================================================

  describe('real-world examples', () => {
    it('CRM contact with company relationship', () => {
      const result = buildRelationships({
        ns: 'https://crm.headless.ly',
        type: 'Contact',
        id: 'john-doe',
        relationships: {
          worksAt: 'acme-corp',
          manages: ['bob-smith', 'alice-jones'],
        },
        references: {
          managedBy: 'jane-manager',
        },
      })

      expect(result).toEqual({
        relationships: {
          worksAt: 'https://crm.headless.ly/companies/acme-corp',
          manages: ['https://crm.headless.ly/contacts/bob-smith', 'https://crm.headless.ly/contacts/alice-jones'],
        },
        references: {
          managedBy: 'https://crm.headless.ly/contacts/jane-manager',
        },
      })
    })

    it('E-commerce order with customer and products', () => {
      const result = buildRelationships({
        ns: 'https://shop.example.com',
        type: 'Order',
        id: 'ord-123',
        relationships: {
          placedBy: 'cust-456',
          contains: ['prod-a', 'prod-b', 'prod-c'],
        },
      })

      expect(result).toEqual({
        relationships: {
          placedBy: 'https://shop.example.com/customers/cust-456',
          contains: [
            'https://shop.example.com/products/prod-a',
            'https://shop.example.com/products/prod-b',
            'https://shop.example.com/products/prod-c',
          ],
        },
      })
    })

    it('Project management task with assignee and project', () => {
      const result = buildRelationships({
        ns: 'https://pm.example.org',
        type: 'Task',
        id: 'task-789',
        relationships: {
          assignedTo: 'user-john',
          belongsTo: 'proj-alpha',
        },
        references: {
          blocks: ['task-101', 'task-102'],
          blockedBy: 'task-100',
        },
      })

      expect(result).toEqual({
        relationships: {
          assignedTo: 'https://pm.example.org/users/user-john',
          belongsTo: 'https://pm.example.org/projects/proj-alpha',
        },
        references: {
          blocks: ['https://pm.example.org/tasks/task-101', 'https://pm.example.org/tasks/task-102'],
          blockedBy: 'https://pm.example.org/tasks/task-100',
        },
      })
    })
  })

  // ============================================================================
  // buildRelationships - Type Safety Tests
  // ============================================================================

  describe('type safety', () => {
    it('accepts string or string array for relationships', () => {
      const relationships: Record<string, string | string[]> = {
        worksAt: 'acme',
        manages: ['bob', 'alice'],
      }

      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships,
      })

      expect(result.relationships).toBeDefined()
    })

    it('accepts string or string array for references', () => {
      const references: Record<string, string | string[]> = {
        managedBy: 'jane',
        mentorOf: ['dave', 'eve'],
      }

      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        references,
      })

      expect(result.references).toBeDefined()
    })

    it('returns correct type shape', () => {
      const result: {
        relationships?: Record<string, string | string[]>
        references?: Record<string, string | string[]>
      } = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
        references: { managedBy: 'jane' },
      })

      expect(typeof result).toBe('object')
    })
  })
})
