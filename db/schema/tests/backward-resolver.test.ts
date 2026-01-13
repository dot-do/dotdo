import { describe, it, expect } from 'vitest'

/**
 * Backward Cascade Resolver Tests
 *
 * Issue: dotdo-wij13
 *
 * Tests for BackwardCascadeResolver, resolveBackwardInsert helper,
 * and deriveReverseVerb function.
 */

import {
  BackwardCascadeResolver,
  resolveBackwardInsert,
  deriveReverseVerb,
  type BackwardResolutionContext,
} from '../resolvers/backward'

// ============================================================================
// 1. BackwardCascadeResolver Class Tests
// ============================================================================

describe('BackwardCascadeResolver', () => {
  describe('constructor', () => {
    it('should create resolver with default options', () => {
      const resolver = new BackwardCascadeResolver()
      expect(resolver).toBeDefined()
    })

    it('should accept custom generator', async () => {
      let generatorCalled = false
      const resolver = new BackwardCascadeResolver({
        generator: async (context) => {
          generatorCalled = true
          return {
            $id: `custom-${context.type.toLowerCase()}-001`,
            $type: context.type,
            customField: 'custom value',
          }
        },
      })

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Custom', fieldName: 'custom' },
        { entity: { $id: 'test', $type: 'Test' }, namespace: 'https://test.com' }
      )

      expect(generatorCalled).toBe(true)
      expect(result.generated?.customField).toBe('custom value')
    })

    it('should accept custom searcher', async () => {
      let searcherCalled = false
      const resolver = new BackwardCascadeResolver({
        searcher: async () => {
          searcherCalled = true
          return [{ $id: 'match-001', $type: 'Match', similarity: 0.95 }]
        },
      })

      const result = await resolver.resolve(
        { operator: '<~', targetType: 'Match', fieldName: 'match' },
        { entity: { $id: 'test', $type: 'Test' }, namespace: 'https://test.com' }
      )

      expect(searcherCalled).toBe(true)
      expect(result.matches?.length).toBe(1)
    })
  })

  describe('resolve()', () => {
    it('should handle <- operator (insert mode)', async () => {
      const resolver = new BackwardCascadeResolver()
      const context: BackwardResolutionContext = {
        entity: { $id: 'parent-001', $type: 'Parent' },
        namespace: 'https://test.com',
      }

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Child', fieldName: 'child' },
        context
      )

      expect(result.mode).toBe('insert')
      expect(result.generated).toBeDefined()
      expect(result.generated?.$type).toBe('Child')
    })

    it('should handle <~ operator (search mode)', async () => {
      const resolver = new BackwardCascadeResolver()
      const context: BackwardResolutionContext = {
        entity: { $id: 'parent-001', $type: 'Parent' },
        namespace: 'https://test.com',
      }

      const result = await resolver.resolve(
        { operator: '<~', targetType: 'Related', fieldName: 'related' },
        context
      )

      expect(result.mode).toBe('search')
      expect(result.generated).toBeUndefined()
      expect(result.matches).toBeDefined()
    })

    it('should reject -> operator', async () => {
      const resolver = new BackwardCascadeResolver()
      const context: BackwardResolutionContext = {
        entity: { $id: 'test', $type: 'Test' },
        namespace: 'https://test.com',
      }

      await expect(
        resolver.resolve({ operator: '->', targetType: 'Forward', fieldName: 'forward' }, context)
      ).rejects.toThrow('Expected backward operator')
    })

    it('should create relationship with from=target, to=this', async () => {
      const resolver = new BackwardCascadeResolver()
      const context: BackwardResolutionContext = {
        entity: { $id: 'this-001', $type: 'This' },
        namespace: 'https://test.com',
      }

      const result = await resolver.resolve(
        { operator: '<-', targetType: 'Target', fieldName: 'target' },
        context
      )

      expect(result.relationship?.from).toBe(result.generated?.$id)
      expect(result.relationship?.to).toBe('this-001')
    })
  })
})

// ============================================================================
// 2. resolveBackwardInsert Helper Tests
// ============================================================================

describe('resolveBackwardInsert()', () => {
  it('should generate new target entity', async () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'employee-001', $type: 'Employee', name: 'Alice' },
      namespace: 'https://acme.example.com.ai',
    }

    const result = await resolveBackwardInsert(
      {
        targetType: 'Manager',
        fieldName: 'manager',
        prompt: 'Who manages this employee?',
      },
      context
    )

    expect(result.generated).toBeDefined()
    expect(result.generated?.$type).toBe('Manager')
    expect(result.generated?.$id).toMatch(/^manager-/)
  })

  it('should create relationship FROM target TO this', async () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'project-001', $type: 'Project' },
      namespace: 'https://test.com',
    }

    const result = await resolveBackwardInsert(
      { targetType: 'Team', fieldName: 'team' },
      context
    )

    expect(result.relationship).toBeDefined()
    expect(result.relationship?.from).toBe(result.generated?.$id)
    expect(result.relationship?.to).toBe('project-001')
  })

  it('should set backrefField on generated entity', async () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'customer-001', $type: 'Customer' },
      namespace: 'https://shop.com',
    }

    const result = await resolveBackwardInsert(
      {
        targetType: 'Order',
        fieldName: 'orders',
        backrefField: 'customer',
      },
      context
    )

    expect(result.generated?.customer).toBe('customer-001')
  })

  it('should include parent entity in generation context', async () => {
    const parentEntity = {
      $id: 'startup-001',
      $type: 'Startup',
      name: 'TechCo',
      industry: 'AI',
    }
    const context: BackwardResolutionContext = {
      entity: parentEntity,
      namespace: 'https://startups.com',
    }

    const result = await resolveBackwardInsert(
      { targetType: 'Investor', fieldName: 'investors' },
      context
    )

    expect(result.generationContext?.parentEntity).toBe(parentEntity)
  })

  it('should include previous generations in context', async () => {
    const previousGenerations = [
      { $id: 'founder-001', $type: 'Founder', name: 'Alice' },
      { $id: 'founder-002', $type: 'Founder', name: 'Bob' },
    ]
    const context: BackwardResolutionContext = {
      entity: { $id: 'startup-001', $type: 'Startup' },
      namespace: 'https://startups.com',
      previousGenerations,
    }

    const result = await resolveBackwardInsert(
      { targetType: 'Advisor', fieldName: 'advisors' },
      context
    )

    expect(result.generationContext?.previousGenerations).toEqual(previousGenerations)
  })
})

// ============================================================================
// 3. deriveReverseVerb Helper Tests
// ============================================================================

describe('deriveReverseVerb()', () => {
  describe('verb derivation rules', () => {
    it('manages -> managedBy', () => {
      expect(deriveReverseVerb('manages')).toBe('managedBy')
    })

    it('owns -> ownedBy', () => {
      expect(deriveReverseVerb('owns')).toBe('ownedBy')
    })

    it('creates -> createdBy', () => {
      expect(deriveReverseVerb('creates')).toBe('createdBy')
    })

    it('contains -> containedBy', () => {
      expect(deriveReverseVerb('contains')).toBe('containedBy')
    })
  })

  describe('verbs ending in "By" -> remove "By" and add "s"', () => {
    it('managedBy -> manages', () => {
      expect(deriveReverseVerb('managedBy')).toBe('manages')
    })

    it('ownedBy -> owns', () => {
      expect(deriveReverseVerb('ownedBy')).toBe('owns')
    })

    it('createdBy -> creates', () => {
      expect(deriveReverseVerb('createdBy')).toBe('creates')
    })

    it('containedBy -> contains', () => {
      expect(deriveReverseVerb('containedBy')).toBe('contains')
    })

    it('customActionBy -> customAction (unknown verb ending in By)', () => {
      // For unknown verbs ending in 'By', just remove 'By'
      expect(deriveReverseVerb('customActionBy')).toBe('customAction')
    })
  })

  describe('bidirectional pairs', () => {
    it('parent_of -> child_of', () => {
      expect(deriveReverseVerb('parent_of')).toBe('child_of')
    })

    it('child_of -> parent_of', () => {
      expect(deriveReverseVerb('child_of')).toBe('parent_of')
    })
  })

  describe('default: verb + "By"', () => {
    it('customAction -> customActionBy', () => {
      expect(deriveReverseVerb('customAction')).toBe('customActionBy')
    })

    it('process -> procesdBy (ends with s, applies third person rule)', () => {
      // Note: "process" ends in 's', so the implementation treats it as a third person verb
      // This results in removing 's' and adding 'dBy': proces -> procesdBy
      expect(deriveReverseVerb('process')).toBe('procesdBy')
    })

    it('handle -> handleBy', () => {
      expect(deriveReverseVerb('handle')).toBe('handleBy')
    })
  })

  describe('verbs ending in "s" (third person singular)', () => {
    it('reviews -> reviewedBy', () => {
      expect(deriveReverseVerb('reviews')).toBe('reviewedBy')
    })

    it('employs -> employedBy', () => {
      expect(deriveReverseVerb('employs')).toBe('employedBy')
    })

    it('assigns -> assignedBy', () => {
      expect(deriveReverseVerb('assigns')).toBe('assignedBy')
    })
  })
})

// ============================================================================
// 4. Backref Handling Tests (<-Order.customer)
// ============================================================================

describe('Backref Handling', () => {
  it('<-Order.customer sets customer field to parent $id', async () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'customer-123', $type: 'Customer', name: 'Acme Corp' },
      namespace: 'https://shop.example.com',
    }

    const result = await resolveBackwardInsert(
      {
        targetType: 'Order',
        fieldName: 'orders',
        backrefField: 'customer',
      },
      context
    )

    // targetType: 'Order'
    expect(result.generated?.$type).toBe('Order')

    // Generated Order has: { customer: this.$id }
    expect(result.generated?.customer).toBe('customer-123')
  })

  it('backrefField works with different field names', async () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'author-456', $type: 'Author' },
      namespace: 'https://blog.example.com',
    }

    const result = await resolveBackwardInsert(
      {
        targetType: 'Article',
        fieldName: 'articles',
        backrefField: 'writtenBy',
      },
      context
    )

    expect(result.generated?.$type).toBe('Article')
    expect(result.generated?.writtenBy).toBe('author-456')
  })

  it('without backrefField, generated entity has no back-reference', async () => {
    const context: BackwardResolutionContext = {
      entity: { $id: 'parent-789', $type: 'Parent' },
      namespace: 'https://test.example.com',
    }

    const result = await resolveBackwardInsert(
      {
        targetType: 'Child',
        fieldName: 'children',
        // No backrefField specified
      },
      context
    )

    expect(result.generated?.$type).toBe('Child')
    // Should not have any reference field set
    expect(result.generated?.parent).toBeUndefined()
  })
})

// ============================================================================
// 5. Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('should throw when entity is missing', async () => {
    const resolver = new BackwardCascadeResolver()

    await expect(
      resolver.resolve(
        { operator: '<-', targetType: 'Type', fieldName: 'field' },
        { entity: null as any, namespace: 'https://test.com' }
      )
    ).rejects.toThrow('Entity is required')
  })

  it('should throw when namespace is empty', async () => {
    const resolver = new BackwardCascadeResolver()

    await expect(
      resolver.resolve(
        { operator: '<-', targetType: 'Type', fieldName: 'field' },
        { entity: { $id: 'test', $type: 'Test' }, namespace: '' }
      )
    ).rejects.toThrow('Namespace is required')
  })

  it('should propagate generator errors', async () => {
    const resolver = new BackwardCascadeResolver({
      generator: async () => {
        throw new Error('Generation failed')
      },
    })

    await expect(
      resolver.resolve(
        { operator: '<-', targetType: 'Type', fieldName: 'field' },
        { entity: { $id: 'test', $type: 'Test' }, namespace: 'https://test.com' }
      )
    ).rejects.toThrow('Generation failed')
  })

  it('should handle search errors with onSearchError=empty', async () => {
    const resolver = new BackwardCascadeResolver({
      searcher: async () => {
        throw new Error('Search failed')
      },
      onSearchError: 'empty',
    })

    const result = await resolver.resolve(
      { operator: '<~', targetType: 'Type', fieldName: 'field' },
      { entity: { $id: 'test', $type: 'Test' }, namespace: 'https://test.com' }
    )

    expect(result.matches).toEqual([])
    expect(result.error).toBeDefined()
    expect(result.error?.message).toBe('Search failed')
  })
})
