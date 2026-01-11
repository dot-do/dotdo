import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Backward Cascade Resolution Tests (RED Phase - TDD)
 *
 * Issue: dotdo-vf8j0
 *
 * These tests verify backward cascade resolution for <- and <~ operators:
 * - Backward Insert (<-): Generate new entity, create relationship FROM target TO this
 * - Backward Search (<~): Semantic search for entities pointing here
 * - Relationship Direction: from=target, to=this (inverse of forward)
 * - Verb Derivation: manages -> managedBy, owns -> ownedBy
 * - Fallback Syntax: '<~Occupation|Role|JobType' - search multiple types
 *
 * Tests will FAIL because the backward resolver doesn't exist yet.
 * This is intentional - RED phase of TDD.
 */

// ============================================================================
// Import from non-existent module (will fail until implemented)
// ============================================================================

import {
  BackwardCascadeResolver,
  resolveBackwardInsert,
  resolveBackwardSearch,
  deriveReverseVerb,
  parseBackwardReference,
  type BackwardReference,
  type BackwardResolutionResult,
  type BackwardResolutionContext,
} from '../resolvers/backward'

// ============================================================================
// Mock Types for Testing
// ============================================================================

interface Entity {
  $id: string
  $type: string
  [key: string]: unknown
}

interface Relationship {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

interface GenerationContext {
  entity: Entity
  namespace: string
  prompt?: string
  previousGenerations?: Entity[]
}

// ============================================================================
// 1. Backward Insert (<-) Tests
// ============================================================================

describe('Backward Insert (<-)', () => {
  describe('basic backward insert', () => {
    it('should generate new target entity', async () => {
      const context: GenerationContext = {
        entity: { $id: 'employee-001', $type: 'Employee', name: 'Alice' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Manager',
        fieldName: 'manager',
        prompt: 'Who manages this employee?',
      }, context)

      expect(result.generated).toBeDefined()
      expect(result.generated.$type).toBe('Manager')
      expect(result.generated.$id).toMatch(/^manager-/)
    })

    it('should create relationship linking FROM target TO this', async () => {
      const context: GenerationContext = {
        entity: { $id: 'project-001', $type: 'Project', name: 'Acme Launch' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Team',
        fieldName: 'team',
        prompt: 'What team owns this project?',
      }, context)

      // Backward: from=target (generated Team), to=this (Project)
      expect(result.relationship).toBeDefined()
      expect(result.relationship.from).toBe(result.generated.$id)
      expect(result.relationship.to).toBe('project-001')
    })

    it('should have target pointing to current entity', async () => {
      const context: GenerationContext = {
        entity: { $id: 'task-001', $type: 'Task', title: 'Fix bug' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Assignee',
        fieldName: 'assignee',
        prompt: 'Who is assigned to this task?',
      }, context)

      // The generated Assignee should reference the Task
      expect(result.relationship.to).toBe(context.entity.$id)
      expect(result.relationship.from).toBe(result.generated.$id)
    })

    it('should use reverse verb naming (manages -> managedBy)', async () => {
      const context: GenerationContext = {
        entity: { $id: 'employee-001', $type: 'Employee', name: 'Bob' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Manager',
        fieldName: 'manager',
        verb: 'manages', // Forward verb from Manager's perspective
        prompt: 'Who manages this employee?',
      }, context)

      // Relationship verb should be the reverse: managedBy
      expect(result.relationship.verb).toBe('managedBy')
    })

    it('should use reverse verb naming (owns -> ownedBy)', async () => {
      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product', name: 'Widget' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Company',
        fieldName: 'company',
        verb: 'owns',
        prompt: 'What company owns this product?',
      }, context)

      expect(result.relationship.verb).toBe('ownedBy')
    })
  })

  describe('backward insert with backref field', () => {
    it('should parse <-Order.customer to extract backrefField', async () => {
      const parsed = parseBackwardReference('<-Order.customer')

      expect(parsed.operator).toBe('<-')
      expect(parsed.targetType).toBe('Order')
      expect(parsed.backrefField).toBe('customer')
    })

    it('should set the backrefField on generated entity', async () => {
      const context: GenerationContext = {
        entity: { $id: 'customer-001', $type: 'Customer', name: 'Acme Corp' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Order',
        fieldName: 'orders',
        backrefField: 'customer',
        prompt: 'Generate an order for this customer',
      }, context)

      // Generated Order should have customer field pointing to Customer
      expect(result.generated.customer).toBe('customer-001')
    })
  })

  describe('backward insert context', () => {
    it('should include parent entity in generation context', async () => {
      const context: GenerationContext = {
        entity: {
          $id: 'startup-001',
          $type: 'Startup',
          name: 'TechCo',
          industry: 'AI',
        },
        namespace: 'https://startups.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Investor',
        fieldName: 'investors',
        prompt: 'Who invests in this startup?',
      }, context)

      // Generated entity should be contextually relevant
      expect(result.generated).toBeDefined()
      expect(result.generationContext?.parentEntity).toBe(context.entity)
    })

    it('should include previous generations in context', async () => {
      const previousGenerations: Entity[] = [
        { $id: 'founder-001', $type: 'Founder', name: 'Alice' },
        { $id: 'founder-002', $type: 'Founder', name: 'Bob' },
      ]

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup', name: 'TechCo' },
        namespace: 'https://startups.example.com.ai',
        previousGenerations,
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Advisor',
        fieldName: 'advisors',
        prompt: 'Who advises this startup?',
      }, context)

      expect(result.generationContext?.previousGenerations).toEqual(previousGenerations)
    })
  })
})

// ============================================================================
// 2. Backward Search (<~) Tests
// ============================================================================

describe('Backward Search (<~)', () => {
  describe('basic backward search', () => {
    it('should perform semantic search for entities pointing here', async () => {
      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product', name: 'Widget Pro' },
        namespace: 'https://shop.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Review',
        fieldName: 'reviews',
        prompt: 'Find reviews for this product',
      }, context)

      expect(result.matches).toBeDefined()
      expect(Array.isArray(result.matches)).toBe(true)
    })

    it('should return entities with relationship TO this', async () => {
      const context: GenerationContext = {
        entity: { $id: 'article-001', $type: 'Article', title: 'How to Code' },
        namespace: 'https://blog.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Comment',
        fieldName: 'comments',
        prompt: 'Find comments on this article',
      }, context)

      // All matched entities should have relationship pointing TO this article
      for (const match of result.matches) {
        expect(match.relationship?.to).toBe('article-001')
      }
    })

    it('should be read-only (no generation)', async () => {
      const context: GenerationContext = {
        entity: { $id: 'topic-001', $type: 'Topic', name: 'JavaScript' },
        namespace: 'https://docs.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Post',
        fieldName: 'posts',
        prompt: 'Find posts about this topic',
      }, context)

      // No generation should occur
      expect(result.generated).toBeUndefined()
      expect(result.isGenerated).toBe(false)
    })

    it('should return empty array when no matches found', async () => {
      const context: GenerationContext = {
        entity: { $id: 'new-product-001', $type: 'Product', name: 'Brand New' },
        namespace: 'https://shop.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Review',
        fieldName: 'reviews',
        prompt: 'Find reviews for this product',
      }, context)

      expect(result.matches).toEqual([])
    })
  })

  describe('backward search with threshold', () => {
    it('should use similarity threshold for matching', async () => {
      const context: GenerationContext = {
        entity: { $id: 'category-001', $type: 'Category', name: 'Electronics' },
        namespace: 'https://shop.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Product',
        fieldName: 'products',
        prompt: 'Find products in this category',
        threshold: 0.85,
      }, context)

      // All matches should meet the threshold
      for (const match of result.matches) {
        expect(match.similarity).toBeGreaterThanOrEqual(0.85)
      }
    })
  })

  describe('backward search with union types (multi-source)', () => {
    it('should support union types for multi-source search', async () => {
      const context: GenerationContext = {
        entity: { $id: 'person-001', $type: 'Person', name: 'Alice' },
        namespace: 'https://hr.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Occupation',
        unionTypes: ['Occupation', 'Role', 'JobType'],
        fieldName: 'occupation',
        prompt: 'Find the occupation of this person',
      }, context)

      // Should search across all union types
      expect(result.searchedTypes).toEqual(['Occupation', 'Role', 'JobType'])
    })

    it('should parse union syntax: <~Occupation|Role|JobType', async () => {
      const parsed = parseBackwardReference('<~Occupation|Role|JobType')

      expect(parsed.operator).toBe('<~')
      expect(parsed.unionTypes).toEqual(['Occupation', 'Role', 'JobType'])
    })

    it('should return first match from union types', async () => {
      const context: GenerationContext = {
        entity: { $id: 'employee-001', $type: 'Employee', name: 'Bob' },
        namespace: 'https://hr.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Occupation',
        unionTypes: ['Occupation', 'Role', 'JobType'],
        fieldName: 'occupation',
        prompt: 'What is this employee occupation?',
      }, context)

      if (result.matches.length > 0) {
        // First match wins
        expect(['Occupation', 'Role', 'JobType']).toContain(result.matches[0].$type)
      }
    })
  })
})

// ============================================================================
// 3. Relationship Direction Tests
// ============================================================================

describe('Relationship Direction', () => {
  describe('backward operator <- creates from=target, to=this', () => {
    it('should set from=target for <- operator', async () => {
      const context: GenerationContext = {
        entity: { $id: 'this-001', $type: 'This', name: 'Current Entity' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Target',
        fieldName: 'target',
      }, context)

      expect(result.relationship.from).toBe(result.generated.$id) // target
      expect(result.relationship.to).toBe('this-001') // this
    })
  })

  describe('forward operator -> creates from=this, to=target', () => {
    // For comparison/validation of inverse behavior
    it('should have opposite direction from forward cascade', async () => {
      const backwardRef = parseBackwardReference('<-Target')

      expect(backwardRef.direction).toBe('backward')
      expect(backwardRef.relationshipDirection).toEqual({
        from: 'target',
        to: 'this',
      })
    })

    it('forward reference should have from=this, to=target', async () => {
      // This validates the contrast
      const forwardRef = parseBackwardReference('->Target')

      expect(forwardRef.direction).toBe('forward')
      expect(forwardRef.relationshipDirection).toEqual({
        from: 'this',
        to: 'target',
      })
    })
  })

  describe('relationship URL construction', () => {
    it('should use namespace-qualified URLs', async () => {
      const context: GenerationContext = {
        entity: { $id: 'entity-001', $type: 'Entity', name: 'Test' },
        namespace: 'https://acme.example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Related',
        fieldName: 'related',
      }, context)

      expect(result.relationship.from).toContain('https://acme.example.com.ai')
      expect(result.relationship.to).toContain('https://acme.example.com.ai')
    })
  })
})

// ============================================================================
// 4. Verb Derivation Tests
// ============================================================================

describe('Verb Derivation', () => {
  describe('deriveReverseVerb function', () => {
    it('should derive manages -> managedBy', () => {
      expect(deriveReverseVerb('manages')).toBe('managedBy')
    })

    it('should derive owns -> ownedBy', () => {
      expect(deriveReverseVerb('owns')).toBe('ownedBy')
    })

    it('should derive creates -> createdBy', () => {
      expect(deriveReverseVerb('creates')).toBe('createdBy')
    })

    it('should derive reviews -> reviewedBy', () => {
      expect(deriveReverseVerb('reviews')).toBe('reviewedBy')
    })

    it('should derive employs -> employedBy', () => {
      expect(deriveReverseVerb('employs')).toBe('employedBy')
    })

    it('should derive contains -> containedBy', () => {
      expect(deriveReverseVerb('contains')).toBe('containedBy')
    })

    it('should derive parent_of -> child_of', () => {
      expect(deriveReverseVerb('parent_of')).toBe('child_of')
    })

    it('should derive child_of -> parent_of', () => {
      expect(deriveReverseVerb('child_of')).toBe('parent_of')
    })

    it('should handle already-reversed verbs: managedBy -> manages', () => {
      expect(deriveReverseVerb('managedBy')).toBe('manages')
    })

    it('should handle unknown verbs by adding "By" suffix', () => {
      expect(deriveReverseVerb('customAction')).toBe('customActionBy')
    })
  })

  describe('verb derivation in context', () => {
    it('should use field name to derive verb when not specified', async () => {
      const context: GenerationContext = {
        entity: { $id: 'project-001', $type: 'Project', name: 'Alpha' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Manager',
        fieldName: 'manager', // Should derive verb from field name
      }, context)

      // Field name 'manager' implies the target 'manages' this entity
      expect(result.relationship.verb).toBe('managedBy')
    })

    it('should use explicit verb when provided', async () => {
      const context: GenerationContext = {
        entity: { $id: 'task-001', $type: 'Task', name: 'Fix bug' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolveBackwardInsert({
        operator: '<-',
        targetType: 'Person',
        fieldName: 'assignee',
        verb: 'assignedTo',
      }, context)

      expect(result.relationship.verb).toBe('assignedTo')
    })
  })
})

// ============================================================================
// 5. Fallback Syntax Tests
// ============================================================================

describe('Fallback Syntax', () => {
  describe('union type fallback search', () => {
    it('should parse <~Occupation|Role|JobType as union fallback', () => {
      const parsed = parseBackwardReference('<~Occupation|Role|JobType')

      expect(parsed.operator).toBe('<~')
      expect(parsed.targetType).toBe('Occupation') // Primary type
      expect(parsed.unionTypes).toEqual(['Occupation', 'Role', 'JobType'])
      expect(parsed.isFallback).toBe(true)
    })

    it('should search types in order (first match wins)', async () => {
      const context: GenerationContext = {
        entity: { $id: 'person-001', $type: 'Person', name: 'Alice' },
        namespace: 'https://hr.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Occupation',
        unionTypes: ['Occupation', 'Role', 'JobType'],
        fieldName: 'work',
        prompt: 'What does this person do?',
        fallbackMode: true,
      }, context)

      // Search order matters - first match wins
      expect(result.searchOrder).toEqual(['Occupation', 'Role', 'JobType'])
    })

    it('should stop searching after first match', async () => {
      const context: GenerationContext = {
        entity: { $id: 'employee-001', $type: 'Employee', name: 'Bob' },
        namespace: 'https://hr.example.com.ai',
      }

      const mockSearchFn = vi.fn()

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Occupation',
        unionTypes: ['Occupation', 'Role', 'JobType'],
        fieldName: 'work',
        prompt: 'What does this person do?',
        fallbackMode: true,
        onSearch: mockSearchFn,
      }, context)

      // If Occupation found, should not search Role or JobType
      if (result.matches.length > 0 && result.matches[0].$type === 'Occupation') {
        expect(result.searchedTypes).toEqual(['Occupation'])
      }
    })

    it('should try all types if no match found', async () => {
      const context: GenerationContext = {
        entity: { $id: 'contractor-001', $type: 'Contractor', name: 'Carol' },
        namespace: 'https://hr.example.com.ai',
      }

      const result = await resolveBackwardSearch({
        operator: '<~',
        targetType: 'Occupation',
        unionTypes: ['Occupation', 'Role', 'JobType'],
        fieldName: 'work',
        prompt: 'What does this contractor do?',
        fallbackMode: true,
        noMatchesScenario: true, // Test helper flag
      }, context)

      // All types should be searched
      expect(result.searchedTypes).toEqual(['Occupation', 'Role', 'JobType'])
      expect(result.matches).toEqual([])
    })
  })

  describe('complex fallback patterns', () => {
    it('should handle mixed insert/search fallback: <-Occupation|<~Role', async () => {
      const parsed = parseBackwardReference('<-Occupation|<~Role')

      expect(parsed.mixedOperators).toBe(true)
      expect(parsed.operations).toEqual([
        { operator: '<-', type: 'Occupation' },
        { operator: '<~', type: 'Role' },
      ])
    })

    it('should handle threshold in fallback: <~Type(0.8)|Other(0.7)', async () => {
      const parsed = parseBackwardReference('<~Type(0.8)|Other(0.7)')

      expect(parsed.unionTypes).toEqual(['Type', 'Other'])
      expect(parsed.thresholds).toEqual({ Type: 0.8, Other: 0.7 })
    })
  })
})

// ============================================================================
// 6. BackwardCascadeResolver Class Tests
// ============================================================================

describe('BackwardCascadeResolver', () => {
  let resolver: BackwardCascadeResolver

  beforeEach(() => {
    resolver = new BackwardCascadeResolver()
  })

  describe('resolve method', () => {
    it('should detect backward insert mode for <- operator', async () => {
      const context: BackwardResolutionContext = {
        entity: { $id: 'test-001', $type: 'Test', name: 'Test Entity' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolver.resolve({
        operator: '<-',
        targetType: 'Related',
        fieldName: 'related',
      }, context)

      expect(result.mode).toBe('insert')
      expect(result.generated).toBeDefined()
    })

    it('should detect backward search mode for <~ operator', async () => {
      const context: BackwardResolutionContext = {
        entity: { $id: 'test-001', $type: 'Test', name: 'Test Entity' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolver.resolve({
        operator: '<~',
        targetType: 'Related',
        fieldName: 'related',
      }, context)

      expect(result.mode).toBe('search')
      expect(result.generated).toBeUndefined()
    })
  })

  describe('createReverseRelationship method', () => {
    it('should create relationship with correct direction', async () => {
      const generated = { $id: 'target-001', $type: 'Target', name: 'Generated' }
      const context: BackwardResolutionContext = {
        entity: { $id: 'this-001', $type: 'This', name: 'Current' },
        namespace: 'https://example.com.ai',
      }

      const relationship = await resolver.createReverseRelationship(
        generated,
        context,
        { verb: 'owns' }
      )

      expect(relationship.from).toBe('https://example.com.ai/target-001')
      expect(relationship.to).toBe('https://example.com.ai/this-001')
      expect(relationship.verb).toBe('ownedBy')
    })
  })

  describe('queryRelatedEntities method', () => {
    it('should query entities with relationship TO this', async () => {
      const context: BackwardResolutionContext = {
        entity: { $id: 'article-001', $type: 'Article', title: 'Test' },
        namespace: 'https://example.com.ai',
      }

      const entities = await resolver.queryRelatedEntities({
        targetType: 'Comment',
        fieldName: 'comments',
      }, context)

      // Should return entities where relationship.to === this.$id
      expect(Array.isArray(entities)).toBe(true)
    })
  })
})

// ============================================================================
// 7. parseBackwardReference Tests
// ============================================================================

describe('parseBackwardReference', () => {
  describe('basic parsing', () => {
    it('should parse <-Type correctly', () => {
      const result = parseBackwardReference('<-Manager')

      expect(result.operator).toBe('<-')
      expect(result.targetType).toBe('Manager')
      expect(result.matchMode).toBe('exact')
      expect(result.direction).toBe('backward')
    })

    it('should parse <~Type correctly', () => {
      const result = parseBackwardReference('<~Review')

      expect(result.operator).toBe('<~')
      expect(result.targetType).toBe('Review')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.direction).toBe('backward')
    })
  })

  describe('with prompt', () => {
    it('should parse "Who manages this? <-Manager"', () => {
      const result = parseBackwardReference('Who manages this? <-Manager')

      expect(result.prompt).toBe('Who manages this?')
      expect(result.operator).toBe('<-')
      expect(result.targetType).toBe('Manager')
    })
  })

  describe('with backref field', () => {
    it('should parse <-Order.customer', () => {
      const result = parseBackwardReference('<-Order.customer')

      expect(result.targetType).toBe('Order')
      expect(result.backrefField).toBe('customer')
    })
  })

  describe('with threshold', () => {
    it('should parse <~Category(0.9)', () => {
      const result = parseBackwardReference('<~Category(0.9)')

      expect(result.targetType).toBe('Category')
      expect(result.threshold).toBe(0.9)
    })
  })

  describe('with union types', () => {
    it('should parse <~A|B|C', () => {
      const result = parseBackwardReference('<~A|B|C')

      expect(result.unionTypes).toEqual(['A', 'B', 'C'])
    })
  })

  describe('with array syntax', () => {
    it('should parse [<-Comment]', () => {
      const result = parseBackwardReference('[<-Comment]')

      expect(result.isArray).toBe(true)
      expect(result.targetType).toBe('Comment')
    })
  })

  describe('optional syntax', () => {
    it('should parse <-Manager?', () => {
      const result = parseBackwardReference('<-Manager?')

      expect(result.isOptional).toBe(true)
      expect(result.targetType).toBe('Manager')
    })
  })
})

// ============================================================================
// 8. Integration Tests
// ============================================================================

describe('Backward Cascade Integration', () => {
  describe('complete backward insert flow', () => {
    it('should generate, create relationship, and return entity', async () => {
      const resolver = new BackwardCascadeResolver()
      const context: BackwardResolutionContext = {
        entity: { $id: 'startup-001', $type: 'Startup', name: 'TechCo' },
        namespace: 'https://startups.example.com.ai',
      }

      const result = await resolver.resolve({
        operator: '<-',
        targetType: 'Idea',
        fieldName: 'idea',
        prompt: 'What is the core idea behind this startup?',
      }, context)

      // Full flow verification
      expect(result.generated).toBeDefined()
      expect(result.generated.$type).toBe('Idea')
      expect(result.relationship).toBeDefined()
      expect(result.relationship.from).toContain('idea')
      expect(result.relationship.to).toContain('startup-001')
      expect(result.relationship.verb).toBe('ideaOf')
    })
  })

  describe('complete backward search flow', () => {
    it('should search, filter, and return matching entities', async () => {
      const resolver = new BackwardCascadeResolver()
      const context: BackwardResolutionContext = {
        entity: { $id: 'product-001', $type: 'Product', name: 'Widget' },
        namespace: 'https://shop.example.com.ai',
      }

      const result = await resolver.resolve({
        operator: '<~',
        targetType: 'Review',
        fieldName: 'reviews',
        prompt: 'Find all reviews for this product',
        threshold: 0.8,
      }, context)

      // Search flow verification
      expect(result.mode).toBe('search')
      expect(Array.isArray(result.matches)).toBe(true)
      expect(result.generated).toBeUndefined()
    })
  })

  describe('schema integration', () => {
    it('should work with schema definition: "<-Idea"', async () => {
      // Schema: { idea: '<-Idea' }
      const schemaField = '<-Idea'
      const parsed = parseBackwardReference(schemaField)
      const resolver = new BackwardCascadeResolver()

      const context: BackwardResolutionContext = {
        entity: { $id: 'startup-001', $type: 'Startup', name: 'NewCo' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolver.resolve({
        ...parsed,
        fieldName: 'idea',
      }, context)

      expect(result.generated?.$type).toBe('Idea')
    })

    it('should work with schema definition: "What is the idea? <-Idea"', async () => {
      const schemaField = 'What is the idea? <-Idea'
      const parsed = parseBackwardReference(schemaField)

      expect(parsed.prompt).toBe('What is the idea?')
      expect(parsed.targetType).toBe('Idea')
      expect(parsed.operator).toBe('<-')
    })
  })
})

// ============================================================================
// 9. Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('invalid operator', () => {
    it('should throw for invalid backward operator', () => {
      expect(() => parseBackwardReference('<<-Type')).toThrow()
    })

    it('should throw for forward operator in backward context', () => {
      const resolver = new BackwardCascadeResolver()

      expect(() => resolver.resolve({
        operator: '->',
        targetType: 'Type',
        fieldName: 'field',
      }, { entity: { $id: 'test', $type: 'Test' }, namespace: 'https://example.com.ai' }))
        .rejects.toThrow('Expected backward operator')
    })
  })

  describe('missing context', () => {
    it('should throw when entity is missing', async () => {
      const resolver = new BackwardCascadeResolver()

      await expect(resolver.resolve({
        operator: '<-',
        targetType: 'Type',
        fieldName: 'field',
      }, { entity: null as any, namespace: 'https://example.com.ai' }))
        .rejects.toThrow('Entity is required')
    })

    it('should throw when namespace is missing', async () => {
      const resolver = new BackwardCascadeResolver()

      await expect(resolver.resolve({
        operator: '<-',
        targetType: 'Type',
        fieldName: 'field',
      }, { entity: { $id: 'test', $type: 'Test' }, namespace: '' }))
        .rejects.toThrow('Namespace is required')
    })
  })

  describe('generation failure', () => {
    it('should handle generation failure gracefully', async () => {
      const resolver = new BackwardCascadeResolver({
        generator: async () => {
          throw new Error('Generation failed')
        },
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'test-001', $type: 'Test' },
        namespace: 'https://example.com.ai',
      }

      await expect(resolver.resolve({
        operator: '<-',
        targetType: 'Type',
        fieldName: 'field',
      }, context)).rejects.toThrow('Generation failed')
    })
  })

  describe('search failure', () => {
    it('should return empty matches on search failure', async () => {
      const resolver = new BackwardCascadeResolver({
        searcher: async () => {
          throw new Error('Search failed')
        },
        onSearchError: 'empty',
      })

      const context: BackwardResolutionContext = {
        entity: { $id: 'test-001', $type: 'Test' },
        namespace: 'https://example.com.ai',
      }

      const result = await resolver.resolve({
        operator: '<~',
        targetType: 'Type',
        fieldName: 'field',
      }, context)

      expect(result.matches).toEqual([])
      expect(result.error).toBeDefined()
    })
  })
})

// ============================================================================
// 10. Type Exports Verification
// ============================================================================

describe('Type Exports', () => {
  it('should export BackwardReference type', () => {
    const ref: BackwardReference = {
      operator: '<-',
      targetType: 'Type',
      fieldName: 'field',
    }
    expect(ref.operator).toBe('<-')
  })

  it('should export BackwardResolutionResult type', () => {
    const result: BackwardResolutionResult = {
      mode: 'insert',
      generated: { $id: 'test', $type: 'Test' },
      relationship: { id: 'rel-1', verb: 'test', from: 'a', to: 'b' },
    }
    expect(result.mode).toBe('insert')
  })

  it('should export BackwardResolutionContext type', () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'test', $type: 'Test' },
      namespace: 'https://example.com.ai',
    }
    expect(context.entity.$id).toBe('test')
  })
})
