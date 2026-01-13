import { describe, it, expect } from 'vitest'

/**
 * Parent/Child Context Navigation Tests (RED Phase)
 *
 * Tests for $context field navigation "up" the hierarchy:
 * - From item to collection to parent DO
 * - At root level, $context should point to parent DO
 * - For orphan DOs (no parent), $context should point to schema.org.ai type definitions
 *
 * These tests verify the response builder properly handles the $context chain
 * for root-level responses with various parent configurations.
 *
 * Expected behavior:
 * - isRoot + parent provided: $context = parent URL
 * - isRoot + no parent + type 'DO': $context = 'https://schema.org.ai/DO'
 * - isRoot + no parent + isCollection: $context = 'https://schema.org.ai/Collection'
 * - isRoot + no parent + other type: $context = 'https://schema.org.ai/{type}'
 *
 * All tests MUST fail (red phase) - implementation not yet complete.
 */

import { buildResponse } from '../linked-data'

// ============================================================================
// Root with Parent Tests
// ============================================================================

describe('buildResponse - parent context navigation', () => {
  describe('root with parent DO', () => {
    it('uses parent URL as $context when parent exists', () => {
      const result = buildResponse(
        { name: 'Headless.ly' },
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
    })

    it('handles deeply nested parent hierarchy', () => {
      // A project within an org within a platform
      const result = buildResponse(
        { name: 'My Project' },
        {
          ns: 'https://myproject.acme.platform.do',
          type: 'Project',
          isRoot: true,
          parent: 'https://acme.platform.do',
        }
      )

      expect(result.$context).toBe('https://acme.platform.do')
      expect(result.$type).toBe('https://myproject.acme.platform.do')
      expect(result.$id).toBe('https://myproject.acme.platform.do')
    })

    it('uses parent for child startup within studio', () => {
      const result = buildResponse(
        { name: 'Child Startup', hypothesis: 'Test hypothesis' },
        {
          ns: 'https://child.Startups.Studio',
          type: 'Startup',
          isRoot: true,
          parent: 'https://Startups.Studio/startups',
        }
      )

      expect(result.$context).toBe('https://Startups.Studio/startups')
      expect(result.name).toBe('Child Startup')
    })
  })

  // ============================================================================
  // Orphan DO Tests (no parent - should default to schema.org.ai)
  // ============================================================================

  describe('orphan DO (no parent)', () => {
    it('defaults to schema.org.ai/DO for orphan DO type', () => {
      const result = buildResponse(
        { name: 'Standalone DO' },
        {
          ns: 'https://standalone.example.org.ai',
          type: 'DO',
          isRoot: true,
          // no parent - orphan DO
        }
      )

      // Should fall back to schema definition for DO type
      expect(result.$context).toBe('https://schema.org.ai/DO')
      expect(result.$type).toBe('https://standalone.example.org.ai')
      expect(result.$id).toBe('https://standalone.example.org.ai')
    })

    it('defaults to schema.org.ai/Startup for orphan Startup type', () => {
      const result = buildResponse(
        { name: 'Independent Startup', hypothesis: 'Going it alone' },
        {
          ns: 'https://independent.startup.ai',
          type: 'Startup',
          isRoot: true,
          // no parent - orphan startup
        }
      )

      // Should fall back to schema definition for Startup type
      expect(result.$context).toBe('https://schema.org.ai/Startup')
      expect(result.$type).toBe('https://independent.startup.ai')
      expect(result.$id).toBe('https://independent.startup.ai')
    })

    it('defaults to schema.org.ai/Agent for orphan Agent type', () => {
      const result = buildResponse(
        { name: 'Autonomous Agent', role: 'worker' },
        {
          ns: 'https://agent.workers.do',
          type: 'Agent',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Agent')
      expect(result.$type).toBe('https://agent.workers.do')
    })

    it('defaults to schema.org.ai/Organization for orphan Organization type', () => {
      const result = buildResponse(
        { name: 'Acme Corp', industry: 'tech' },
        {
          ns: 'https://acme.org.ai',
          type: 'Organization',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Organization')
    })
  })

  // ============================================================================
  // Orphan Collection Tests
  // ============================================================================

  describe('orphan Collection (no parent)', () => {
    it('defaults to schema.org.ai/Collection for orphan Collection type', () => {
      const result = buildResponse(
        { items: [], total: 0 },
        {
          ns: 'https://Startups.Studio',
          type: 'Collection',
          isRoot: true,
          isCollection: true,
          // no parent - top-level collection
        }
      )

      // Orphan collection should reference Collection schema
      expect(result.$context).toBe('https://schema.org.ai/Collection')
      expect(result.$type).toBe('https://Startups.Studio')
      expect(result.$id).toBe('https://Startups.Studio')
    })

    it('defaults to schema.org.ai/Collection for any orphan root collection', () => {
      const result = buildResponse(
        { items: [{ name: 'Item 1' }], count: 1 },
        {
          ns: 'https://items.example.org.ai',
          type: 'Item',
          isRoot: true,
          isCollection: true,
          // no parent
        }
      )

      // isCollection at root without parent should use Collection schema
      expect(result.$context).toBe('https://schema.org.ai/Collection')
    })

    it('uses parent when collection has parent', () => {
      const result = buildResponse(
        { items: [], total: 0 },
        {
          ns: 'https://portfolio.Startups.Studio',
          type: 'Startup',
          isRoot: true,
          isCollection: true,
          parent: 'https://Startups.Studio',
        }
      )

      // Collection with parent should use parent
      expect(result.$context).toBe('https://Startups.Studio')
    })
  })

  // ============================================================================
  // Parent Relationship Storage Tests
  // ============================================================================

  describe('parent relationship stored and retrievable', () => {
    it('preserves parent in response metadata', () => {
      const result = buildResponse(
        { name: 'Child Entity' },
        {
          ns: 'https://child.parent.org.ai',
          type: 'Entity',
          isRoot: true,
          parent: 'https://parent.org.ai',
        }
      )

      // The $context should always equal parent when parent is provided
      expect(result.$context).toBe('https://parent.org.ai')

      // Verify the context chain is navigable
      // $context should be a valid URL that can be fetched
      expect(result.$context).toMatch(/^https?:\/\//)
    })

    it('maintains bidirectional relationship through context chain', () => {
      // Parent response
      const parentResult = buildResponse(
        { name: 'Parent DO', children: ['https://child.parent.org.ai'] },
        {
          ns: 'https://parent.org.ai',
          type: 'DO',
          isRoot: true,
          parent: 'https://schema.org.ai/DO',
        }
      )

      // Child response
      const childResult = buildResponse(
        { name: 'Child DO' },
        {
          ns: 'https://child.parent.org.ai',
          type: 'DO',
          isRoot: true,
          parent: 'https://parent.org.ai',
        }
      )

      // Child's context points to parent's ID
      expect(childResult.$context).toBe(parentResult.$id)
    })
  })

  // ============================================================================
  // Context Chain Verification Tests
  // ============================================================================

  describe('context chain integrity', () => {
    it('orphan chain terminates at schema.org.ai', () => {
      const result = buildResponse(
        { name: 'Orphan' },
        {
          ns: 'https://orphan.org.ai',
          type: 'Entity',
          isRoot: true,
          // no parent
        }
      )

      // Orphan should point to schema.org.ai
      expect(result.$context).toMatch(/^https:\/\/schema\.org\.ai\//)
    })

    it('parented chain terminates at parent', () => {
      const result = buildResponse(
        { name: 'Parented' },
        {
          ns: 'https://child.org.ai',
          type: 'Entity',
          isRoot: true,
          parent: 'https://parent.org.ai',
        }
      )

      // Parented entity should point to parent
      expect(result.$context).not.toMatch(/^https:\/\/schema\.org\.ai\//)
      expect(result.$context).toBe('https://parent.org.ai')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases for parent context', () => {
    it('handles empty string parent as orphan', () => {
      const result = buildResponse(
        { name: 'Empty Parent' },
        {
          ns: 'https://test.org.ai',
          type: 'DO',
          isRoot: true,
          parent: '', // empty string should be treated as no parent
        }
      )

      // Empty parent should be treated as orphan
      expect(result.$context).toBe('https://schema.org.ai/DO')
    })

    it('handles undefined parent as orphan', () => {
      const result = buildResponse(
        { name: 'Undefined Parent' },
        {
          ns: 'https://test.org.ai',
          type: 'DO',
          isRoot: true,
          parent: undefined,
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/DO')
    })

    it('handles whitespace-only parent as orphan', () => {
      const result = buildResponse(
        { name: 'Whitespace Parent' },
        {
          ns: 'https://test.org.ai',
          type: 'DO',
          isRoot: true,
          parent: '   ', // whitespace should be treated as no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/DO')
    })

    it('non-root responses ignore orphan fallback', () => {
      // Non-root responses should NOT use schema.org.ai fallback
      // They always use the namespace as context
      const result = buildResponse(
        { name: 'Item' },
        {
          ns: 'https://test.org.ai',
          type: 'Customer',
          id: 'alice',
          // Not isRoot, no parent
        }
      )

      // Non-root should use ns as context, not schema.org.ai
      expect(result.$context).toBe('https://test.org.ai')
      expect(result.$context).not.toMatch(/schema\.org\.ai/)
    })
  })

  // ============================================================================
  // Type-Specific Schema Defaults
  // ============================================================================

  describe('type-specific schema defaults', () => {
    it('uses correct schema URL for Workflow type', () => {
      const result = buildResponse(
        { name: 'My Workflow', steps: [] },
        {
          ns: 'https://workflow.example.org.ai',
          type: 'Workflow',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Workflow')
    })

    it('uses correct schema URL for Human type', () => {
      const result = buildResponse(
        { name: 'Approver', role: 'manager' },
        {
          ns: 'https://approver.humans.do',
          type: 'Human',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Human')
    })

    it('uses correct schema URL for Entity type', () => {
      const result = buildResponse(
        { name: 'Generic Entity' },
        {
          ns: 'https://entity.example.org.ai',
          type: 'Entity',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Entity')
    })

    it('uses correct schema URL for Thing type', () => {
      const result = buildResponse(
        { name: 'Generic Thing' },
        {
          ns: 'https://thing.example.org.ai',
          type: 'Thing',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Thing')
    })
  })
})
