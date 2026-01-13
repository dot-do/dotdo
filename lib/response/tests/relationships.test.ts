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

  // ============================================================================
  // buildRelationships - Many-to-Many Relationship Tests
  // ============================================================================

  describe('many-to-many relationships', () => {
    it('handles many-to-many tag relationship', () => {
      // Article has many Tags, Tags have many Articles
      const result = buildRelationships({
        ns: 'https://blog.example.com',
        type: 'Article',
        id: 'article-1',
        relationships: {
          taggedWith: ['javascript', 'typescript', 'nodejs'],
        },
      })

      expect(result.relationships?.taggedWith).toEqual([
        'https://blog.example.com/articles/javascript',
        'https://blog.example.com/articles/typescript',
        'https://blog.example.com/articles/nodejs',
      ])
    })

    it('handles many-to-many user-role relationship', () => {
      // User has many Roles, Roles have many Users
      const result = buildRelationships({
        ns: 'https://auth.example.com',
        type: 'User',
        id: 'user-1',
        relationships: {
          hasRoles: ['admin', 'editor', 'viewer'],
        },
        references: {
          memberOf: ['team-alpha', 'team-beta'],
        },
      })

      expect(result.relationships?.hasRoles).toEqual([
        'https://auth.example.com/users/admin',
        'https://auth.example.com/users/editor',
        'https://auth.example.com/users/viewer',
      ])
      expect(result.references?.memberOf).toEqual([
        'https://auth.example.com/users/team-alpha',
        'https://auth.example.com/users/team-beta',
      ])
    })

    it('handles bidirectional many-to-many', () => {
      // Student enrolled in Courses, Course has Students
      const studentResult = buildRelationships({
        ns: 'https://school.edu',
        type: 'Student',
        id: 'student-123',
        relationships: {
          enrolledIn: ['course-math', 'course-science'],
        },
      })

      const courseResult = buildRelationships({
        ns: 'https://school.edu',
        type: 'Course',
        id: 'course-math',
        references: {
          hasStudents: ['student-123', 'student-456'],
        },
      })

      // Both should be arrays of URLs
      expect(Array.isArray(studentResult.relationships?.enrolledIn)).toBe(true)
      expect(Array.isArray(courseResult.references?.hasStudents)).toBe(true)
    })

    it('handles large arrays efficiently', () => {
      // Test with 100 relationships
      const manyIds = Array.from({ length: 100 }, (_, i) => `follower-${i}`)

      const result = buildRelationships({
        ns: 'https://social.example.com',
        type: 'User',
        id: 'influencer',
        relationships: {
          followers: manyIds,
        },
      })

      const followers = result.relationships?.followers as string[]
      expect(followers).toHaveLength(100)
      expect(followers[0]).toBe('https://social.example.com/users/follower-0')
      expect(followers[99]).toBe('https://social.example.com/users/follower-99')
    })
  })

  // ============================================================================
  // buildRelationships - Inverse Relationship Tests
  // ============================================================================

  describe('inverse relationships', () => {
    it('handles parent-child inverse relationship', () => {
      // Parent side
      const parentResult = buildRelationships({
        ns: 'https://family.example.com',
        type: 'Person',
        id: 'alice',
        relationships: {
          hasChildren: ['bob', 'carol'],
        },
      })

      // Child side (inverse)
      const childResult = buildRelationships({
        ns: 'https://family.example.com',
        type: 'Person',
        id: 'bob',
        references: {
          childOf: 'alice',
        },
      })

      expect(parentResult.relationships?.hasChildren).toEqual([
        'https://family.example.com/people/bob',
        'https://family.example.com/people/carol',
      ])
      expect(childResult.references?.childOf).toBe('https://family.example.com/people/alice')
    })

    it('handles manager-employee inverse relationship', () => {
      // Manager side
      const managerResult = buildRelationships({
        ns: 'https://hr.example.com',
        type: 'Employee',
        id: 'jane-manager',
        relationships: {
          manages: ['john', 'alice', 'bob'],
        },
      })

      // Employee side (inverse)
      const employeeResult = buildRelationships({
        ns: 'https://hr.example.com',
        type: 'Employee',
        id: 'john',
        references: {
          managedBy: 'jane-manager',
        },
      })

      expect(managerResult.relationships?.manages).toEqual([
        'https://hr.example.com/employees/john',
        'https://hr.example.com/employees/alice',
        'https://hr.example.com/employees/bob',
      ])
      expect(employeeResult.references?.managedBy).toBe('https://hr.example.com/employees/jane-manager')
    })

    it('handles self-referential relationships (same entity type)', () => {
      const result = buildRelationships({
        ns: 'https://org.example.com',
        type: 'Department',
        id: 'engineering',
        relationships: {
          subDepartments: ['frontend', 'backend', 'devops'],
        },
        references: {
          parentDepartment: 'tech',
        },
      })

      // subDepartments and parentDepartment should both reference departments
      expect(result.relationships?.subDepartments).toEqual([
        'https://org.example.com/departments/frontend',
        'https://org.example.com/departments/backend',
        'https://org.example.com/departments/devops',
      ])
      expect(result.references?.parentDepartment).toBe('https://org.example.com/departments/tech')
    })

    it('handles symmetrical relationships (friends)', () => {
      // Alice's friends
      const aliceResult = buildRelationships({
        ns: 'https://social.example.com',
        type: 'User',
        id: 'alice',
        relationships: {
          friends: ['bob', 'carol'],
        },
      })

      // Bob's friends (includes Alice - symmetrical)
      const bobResult = buildRelationships({
        ns: 'https://social.example.com',
        type: 'User',
        id: 'bob',
        relationships: {
          friends: ['alice', 'dave'],
        },
      })

      expect(aliceResult.relationships?.friends).toContain('https://social.example.com/users/bob')
      expect(bobResult.relationships?.friends).toContain('https://social.example.com/users/alice')
    })
  })

  // ============================================================================
  // buildRelationships - Relationship Metadata / Verb Type Inference Tests
  // ============================================================================

  describe('relationship metadata and verb type inference', () => {
    it('infers Company type from worksAt verb', () => {
      const result = buildRelationships({
        ns: 'https://crm.example.com',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      expect(result.relationships?.worksAt).toContain('/companies/')
    })

    it('infers Company type from employeeOf verb', () => {
      const result = buildRelationships({
        ns: 'https://crm.example.com',
        type: 'Contact',
        id: 'john',
        references: { employeeOf: 'techcorp' },
      })

      expect(result.references?.employeeOf).toContain('/companies/')
    })

    it('infers Category type from belongsTo verb', () => {
      const result = buildRelationships({
        ns: 'https://store.example.com',
        type: 'Product',
        id: 'widget',
        relationships: { belongsTo: 'electronics' },
      })

      expect(result.relationships?.belongsTo).toContain('/categories/')
    })

    it('infers User type from assignedTo verb', () => {
      const result = buildRelationships({
        ns: 'https://pm.example.com',
        type: 'Task',
        id: 'task-1',
        relationships: { assignedTo: 'user-john' },
      })

      expect(result.relationships?.assignedTo).toContain('/users/')
    })

    it('infers Customer type from placedBy verb', () => {
      const result = buildRelationships({
        ns: 'https://shop.example.com',
        type: 'Order',
        id: 'order-123',
        relationships: { placedBy: 'customer-456' },
      })

      expect(result.relationships?.placedBy).toContain('/customers/')
    })

    it('infers Product type from contains verb', () => {
      const result = buildRelationships({
        ns: 'https://shop.example.com',
        type: 'Order',
        id: 'order-123',
        relationships: { contains: ['prod-a', 'prod-b'] },
      })

      const contains = result.relationships?.contains as string[]
      expect(contains[0]).toContain('/products/')
    })

    it('infers Project type from Task.belongsTo verb', () => {
      const result = buildRelationships({
        ns: 'https://pm.example.com',
        type: 'Task',
        id: 'task-1',
        relationships: { belongsTo: 'proj-alpha' },
      })

      expect(result.relationships?.belongsTo).toContain('/projects/')
    })

    it('infers Task type from blocks/blockedBy verbs', () => {
      const result = buildRelationships({
        ns: 'https://pm.example.com',
        type: 'Task',
        id: 'task-1',
        relationships: { blocks: 'task-2' },
        references: { blockedBy: 'task-0' },
      })

      expect(result.relationships?.blocks).toContain('/tasks/')
      expect(result.references?.blockedBy).toContain('/tasks/')
    })

    it('defaults to same type for unknown verbs', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Widget',
        id: 'widget-1',
        relationships: { connectedTo: 'widget-2' },
      })

      expect(result.relationships?.connectedTo).toContain('/widgets/')
    })

    it('handles custom verbs consistently', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Node',
        id: 'node-1',
        relationships: {
          upstream: ['node-2', 'node-3'],
          downstream: ['node-4', 'node-5'],
        },
      })

      const upstream = result.relationships?.upstream as string[]
      const downstream = result.relationships?.downstream as string[]

      // All should be nodes since verb is unknown
      upstream.forEach((url) => expect(url).toContain('/nodes/'))
      downstream.forEach((url) => expect(url).toContain('/nodes/'))
    })
  })

  // ============================================================================
  // buildRelationships - Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty relationships object', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: {},
      })

      expect(result.relationships).toBeUndefined()
    })

    it('handles empty references object', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        references: {},
      })

      expect(result.references).toBeUndefined()
    })

    it('handles both empty objects', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: {},
        references: {},
      })

      expect(result).toEqual({})
    })

    it('handles IDs with unicode characters', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { knows: '田中太郎' },
      })

      // Unicode should be URL-encoded
      expect(result.relationships?.knows).toContain('%')
      expect(result.relationships?.knows).toMatch(/^https:\/\/example\.com\/contacts\//)
    })

    it('handles IDs with slashes', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme/division/sales' },
      })

      // Slashes should be encoded
      expect(result.relationships?.worksAt).toContain('%2F')
    })

    it('handles IDs with query string characters', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { knows: 'user?name=test' },
      })

      // ? should be encoded
      expect(result.relationships?.knows).toContain('%3F')
    })

    it('handles IDs with hash characters', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { knows: 'user#123' },
      })

      // # should be encoded
      expect(result.relationships?.knows).toContain('%23')
    })

    it('handles numeric string IDs', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: '12345' },
      })

      expect(result.relationships?.worksAt).toBe('https://example.com/companies/12345')
    })

    it('handles UUID IDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: uuid },
      })

      expect(result.relationships?.worksAt).toBe(`https://example.com/companies/${uuid}`)
    })

    it('handles mixed case type names', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'UserProfile',
        id: 'john',
        relationships: { follows: 'jane' },
      })

      // UserProfile should become userprofiles
      expect(result.relationships?.follows).toContain('/userprofiles/')
    })

    it('handles namespace with multiple path segments', () => {
      const result = buildRelationships({
        ns: 'https://api.example.com/v2/tenant/acme',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'corp' },
      })

      expect(result.relationships?.worksAt).toBe('https://api.example.com/v2/tenant/acme/companies/corp')
    })

    it('handles very long IDs', () => {
      const longId = 'a'.repeat(1000)
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { knows: longId },
      })

      expect(result.relationships?.knows).toContain(longId)
    })
  })

  // ============================================================================
  // buildRelationships - Link Generation Format Tests
  // ============================================================================

  describe('link generation format', () => {
    it('generates consistent URL format: {ns}/{pluralType}/{id}', () => {
      const result = buildRelationships({
        ns: 'https://api.example.com',
        type: 'Customer',
        id: 'cust-1',
        relationships: { reportsTo: 'manager-1' },
      })

      // Should match exact format
      expect(result.relationships?.reportsTo).toMatch(/^https:\/\/api\.example\.com\/customers\/manager-1$/)
    })

    it('generates URLs without double slashes', () => {
      const result = buildRelationships({
        ns: 'https://api.example.com/',
        type: 'Customer',
        id: 'cust-1',
        relationships: { reportsTo: 'manager-1' },
      })

      // Should not have double slashes in path (except for protocol https://)
      const urlWithoutProtocol = (result.relationships?.reportsTo as string).replace('https://', '')
      expect(urlWithoutProtocol).not.toContain('//')
      expect(result.relationships?.reportsTo).toBe('https://api.example.com/customers/manager-1')
    })

    it('preserves exact ID casing in URLs', () => {
      const result = buildRelationships({
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { knows: 'JohnDoe_123' },
      })

      expect(result.relationships?.knows).toContain('JohnDoe_123')
    })

    it('generates deterministic URLs for same input', () => {
      const options = {
        ns: 'https://example.com',
        type: 'Contact',
        id: 'john',
        relationships: { knows: 'jane' },
      }

      const result1 = buildRelationships(options)
      const result2 = buildRelationships(options)

      expect(result1.relationships?.knows).toBe(result2.relationships?.knows)
    })
  })

  // ============================================================================
  // buildRelationships - Integration with Response Builder
  // ============================================================================

  describe('integration scenarios', () => {
    it('produces relationship URLs usable in JSON-LD responses', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'acme',
          manages: ['bob', 'alice'],
        },
        references: {
          managedBy: 'jane',
        },
      })

      // Verify structure is suitable for JSON-LD
      expect(result.relationships).toBeDefined()
      expect(result.references).toBeDefined()

      // All URLs should be strings (not objects)
      expect(typeof result.relationships?.worksAt).toBe('string')
      expect(Array.isArray(result.relationships?.manages)).toBe(true)
      expect(typeof result.references?.managedBy).toBe('string')
    })

    it('produces URLs that can be fetched', () => {
      const result = buildRelationships({
        ns: 'https://headless.ly',
        type: 'Contact',
        id: 'john',
        relationships: { worksAt: 'acme' },
      })

      // URL should be valid and parseable
      const url = new URL(result.relationships?.worksAt as string)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('headless.ly')
      expect(url.pathname).toBe('/companies/acme')
    })

    it('handles cross-tenant relationships', () => {
      // Relationship to entity in different namespace
      const result = buildRelationships({
        ns: 'https://tenant-a.example.com',
        type: 'Contact',
        id: 'john',
        relationships: {
          worksAt: 'global-corp', // Company in same namespace
        },
      })

      // Should use the source namespace
      expect(result.relationships?.worksAt).toBe('https://tenant-a.example.com/companies/global-corp')
    })
  })
})
