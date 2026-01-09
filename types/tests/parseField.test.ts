import { describe, it, expect } from 'vitest'

/**
 * Advanced parseField Operator Tests (RED Phase - TDD)
 *
 * Issue: dotdo-j9cvo
 *
 * These tests verify advanced parseField syntax parsing:
 * - Threshold syntax: parseField('category', '~>Category(0.9)') returns threshold: 0.9
 * - Union types: parseField('owner', '->Person|Company') returns unionTypes: ['Person', 'Company']
 * - Backref field: parseField('orders', '<-Order.customer') returns backrefField: 'customer'
 * - Combined: '~>Type(0.8)|Other' parses both threshold and union
 *
 * Tests will FAIL because the advanced parsing features don't exist yet.
 * This is intentional - RED phase of TDD.
 */

// ============================================================================
// Import parseField function
// ============================================================================

import { parseField, type ParsedField } from '../Noun'

// ============================================================================
// 1. Threshold Syntax Tests
// ============================================================================

describe('parseField Threshold Syntax', () => {
  describe('basic threshold parsing', () => {
    it('should parse ~>Category(0.9) and return threshold: 0.9', () => {
      const result = parseField('category', '~>Category(0.9)')

      expect(result.name).toBe('category')
      expect(result.operator).toBe('~>')
      expect(result.relatedType).toBe('Category')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.threshold).toBe(0.9)
    })

    it('should parse ~>Tag(0.8) with different threshold', () => {
      const result = parseField('tags', '~>Tag(0.8)')

      expect(result.threshold).toBe(0.8)
      expect(result.relatedType).toBe('Tag')
    })

    it('should parse ~>Topic(0.5) with 0.5 threshold', () => {
      const result = parseField('topic', '~>Topic(0.5)')

      expect(result.threshold).toBe(0.5)
    })

    it('should parse ~>Entity(1.0) with 1.0 threshold', () => {
      const result = parseField('entity', '~>Entity(1.0)')

      expect(result.threshold).toBe(1.0)
    })

    it('should parse ~>Match(0.95) with high precision threshold', () => {
      const result = parseField('match', '~>Match(0.95)')

      expect(result.threshold).toBe(0.95)
    })
  })

  describe('threshold with prompt', () => {
    it('should parse "What category? ~>Category(0.9)" with prompt and threshold', () => {
      const result = parseField('category', 'What category? ~>Category(0.9)')

      expect(result.prompt).toBe('What category?')
      expect(result.threshold).toBe(0.9)
      expect(result.relatedType).toBe('Category')
    })

    it('should parse complex prompt with threshold', () => {
      const result = parseField('topic', 'Analyze the main topic ~>Topic(0.85)')

      expect(result.prompt).toBe('Analyze the main topic')
      expect(result.threshold).toBe(0.85)
    })
  })

  describe('threshold edge cases', () => {
    it('should handle threshold with no decimal: ~>Type(1)', () => {
      const result = parseField('type', '~>Type(1)')

      expect(result.threshold).toBe(1)
    })

    it('should handle threshold with leading zero: ~>Type(0.1)', () => {
      const result = parseField('type', '~>Type(0.1)')

      expect(result.threshold).toBe(0.1)
    })

    it('should default to undefined threshold when not specified: ~>Type', () => {
      const result = parseField('type', '~>Type')

      expect(result.threshold).toBeUndefined()
    })
  })
})

// ============================================================================
// 2. Union Types Tests
// ============================================================================

describe('parseField Union Types', () => {
  describe('basic union type parsing', () => {
    it('should parse ->Person|Company and return unionTypes: ["Person", "Company"]', () => {
      const result = parseField('owner', '->Person|Company')

      expect(result.name).toBe('owner')
      expect(result.operator).toBe('->')
      expect(result.isRelation).toBe(true)
      expect(result.unionTypes).toEqual(['Person', 'Company'])
    })

    it('should parse ->Cat|Dog|Bird with three types', () => {
      const result = parseField('pet', '->Cat|Dog|Bird')

      expect(result.unionTypes).toEqual(['Cat', 'Dog', 'Bird'])
    })

    it('should parse ->A|B|C|D|E with many types', () => {
      const result = parseField('multi', '->A|B|C|D|E')

      expect(result.unionTypes).toEqual(['A', 'B', 'C', 'D', 'E'])
    })
  })

  describe('union types with different operators', () => {
    it('should parse ~>Person|Company with fuzzy operator', () => {
      const result = parseField('owner', '~>Person|Company')

      expect(result.operator).toBe('~>')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.unionTypes).toEqual(['Person', 'Company'])
    })

    it('should parse <-Order|Invoice with backward relation', () => {
      const result = parseField('documents', '<-Order|Invoice')

      expect(result.operator).toBe('<-')
      expect(result.direction).toBe('backward')
      expect(result.unionTypes).toEqual(['Order', 'Invoice'])
    })

    it('should parse <~Order|Invoice with fuzzy backward relation', () => {
      const result = parseField('documents', '<~Order|Invoice')

      expect(result.operator).toBe('<~')
      expect(result.direction).toBe('backward')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.unionTypes).toEqual(['Order', 'Invoice'])
    })
  })

  describe('union types with arrays', () => {
    it('should parse [->Tag|Category] as array of union types', () => {
      const result = parseField('tags', '[->Tag|Category]')

      expect(result.isArray).toBe(true)
      expect(result.unionTypes).toEqual(['Tag', 'Category'])
    })
  })

  describe('single type (no union)', () => {
    it('should not have unionTypes for single type ->Person', () => {
      const result = parseField('owner', '->Person')

      expect(result.relatedType).toBe('Person')
      expect(result.unionTypes).toBeUndefined()
    })
  })
})

// ============================================================================
// 3. Backref Field Tests
// ============================================================================

describe('parseField Backref Field', () => {
  describe('basic backref parsing', () => {
    it('should parse <-Order.customer and return backrefField: "customer"', () => {
      const result = parseField('orders', '<-Order.customer')

      expect(result.name).toBe('orders')
      expect(result.operator).toBe('<-')
      expect(result.direction).toBe('backward')
      expect(result.relatedType).toBe('Order')
      expect(result.backrefField).toBe('customer')
    })

    it('should parse <-Invoice.client with different backref field', () => {
      const result = parseField('invoices', '<-Invoice.client')

      expect(result.relatedType).toBe('Invoice')
      expect(result.backrefField).toBe('client')
    })

    it('should parse <-Comment.author', () => {
      const result = parseField('comments', '<-Comment.author')

      expect(result.relatedType).toBe('Comment')
      expect(result.backrefField).toBe('author')
    })

    it('should parse <-Review.product', () => {
      const result = parseField('reviews', '<-Review.product')

      expect(result.relatedType).toBe('Review')
      expect(result.backrefField).toBe('product')
    })
  })

  describe('backref with fuzzy operator', () => {
    it('should parse <~Order.customer with fuzzy backref', () => {
      const result = parseField('orders', '<~Order.customer')

      expect(result.operator).toBe('<~')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.relatedType).toBe('Order')
      expect(result.backrefField).toBe('customer')
    })
  })

  describe('backref edge cases', () => {
    it('should not have backrefField for forward relation ->Order', () => {
      const result = parseField('order', '->Order')

      expect(result.backrefField).toBeUndefined()
    })

    it('should not have backrefField for backward relation without dot: <-Order', () => {
      const result = parseField('orders', '<-Order')

      expect(result.backrefField).toBeUndefined()
      expect(result.relatedType).toBe('Order')
    })

    it('should handle backref with underscore: <-Order.customer_id', () => {
      const result = parseField('orders', '<-Order.customer_id')

      expect(result.backrefField).toBe('customer_id')
    })

    it('should handle backref with camelCase: <-Order.customerId', () => {
      const result = parseField('orders', '<-Order.customerId')

      expect(result.backrefField).toBe('customerId')
    })
  })
})

// ============================================================================
// 4. Combined Syntax Tests
// ============================================================================

describe('parseField Combined Syntax', () => {
  describe('threshold with union types', () => {
    it('should parse ~>Type(0.8)|Other with both threshold and union', () => {
      const result = parseField('entity', '~>Type(0.8)|Other')

      expect(result.operator).toBe('~>')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.threshold).toBe(0.8)
      expect(result.unionTypes).toEqual(['Type', 'Other'])
    })

    it('should parse ~>Person(0.9)|Company(0.85) with per-type thresholds', () => {
      // This may need special handling - both types have thresholds
      const result = parseField('owner', '~>Person(0.9)|Company(0.85)')

      // Expected: unionTypes with their thresholds
      expect(result.unionTypes).toBeDefined()
      // The exact shape depends on implementation
    })

    it('should parse ~>A(0.7)|B|C(0.8) with mixed thresholds', () => {
      const result = parseField('mixed', '~>A(0.7)|B|C(0.8)')

      expect(result.matchMode).toBe('fuzzy')
      expect(result.unionTypes).toBeDefined()
    })
  })

  describe('backref with union types', () => {
    it('should parse <-Order.customer|Invoice.client as union backrefs', () => {
      const result = parseField('documents', '<-Order.customer|Invoice.client')

      expect(result.direction).toBe('backward')
      // May return array of {type, backrefField} or handle differently
      expect(result.unionTypes).toBeDefined()
    })
  })

  describe('prompt with threshold and union', () => {
    it('should parse "Select owner ~>Person(0.8)|Company" with all features', () => {
      const result = parseField('owner', 'Select owner ~>Person(0.8)|Company')

      expect(result.prompt).toBe('Select owner')
      expect(result.threshold).toBe(0.8)
      expect(result.unionTypes).toBeDefined()
    })
  })

  describe('array with union and threshold', () => {
    it('should parse [~>Tag(0.7)|Category] as array union with threshold', () => {
      const result = parseField('tags', '[~>Tag(0.7)|Category]')

      expect(result.isArray).toBe(true)
      expect(result.threshold).toBe(0.7)
      expect(result.unionTypes).toEqual(['Tag', 'Category'])
    })
  })

  describe('optional with combined features', () => {
    it('should parse ~>Type(0.8)|Other? as optional union with threshold', () => {
      const result = parseField('entity', '~>Type(0.8)|Other?')

      expect(result.isOptional).toBe(true)
      expect(result.threshold).toBe(0.8)
      expect(result.unionTypes).toBeDefined()
    })
  })
})

// ============================================================================
// 5. ParsedField Type Should Have New Properties
// ============================================================================

describe('ParsedField Type Properties', () => {
  it('ParsedField should have threshold property', () => {
    const result = parseField('test', '~>Type(0.9)')

    // TypeScript should know about threshold
    const threshold: number | undefined = result.threshold
    expect(typeof threshold === 'number' || threshold === undefined).toBe(true)
  })

  it('ParsedField should have unionTypes property', () => {
    const result = parseField('test', '->A|B')

    // TypeScript should know about unionTypes
    const unionTypes: string[] | undefined = result.unionTypes
    expect(Array.isArray(unionTypes) || unionTypes === undefined).toBe(true)
  })

  it('ParsedField should have backrefField property', () => {
    const result = parseField('test', '<-Order.customer')

    // TypeScript should know about backrefField
    const backrefField: string | undefined = result.backrefField
    expect(typeof backrefField === 'string' || backrefField === undefined).toBe(true)
  })
})

// ============================================================================
// 6. Backward Compatibility Tests
// ============================================================================

describe('parseField Backward Compatibility', () => {
  it('should still parse simple string type', () => {
    const result = parseField('name', 'string')

    expect(result.name).toBe('name')
    expect(result.type).toBe('string')
    expect(result.isRelation).toBe(false)
  })

  it('should still parse simple relation ->Type', () => {
    const result = parseField('owner', '->Person')

    expect(result.operator).toBe('->')
    expect(result.relatedType).toBe('Person')
    expect(result.isRelation).toBe(true)
  })

  it('should still parse array type [string]', () => {
    const result = parseField('tags', 'string[]')

    expect(result.isArray).toBe(true)
    expect(result.type).toBe('string')
  })

  it('should still parse optional type string?', () => {
    const result = parseField('nickname', 'string?')

    expect(result.isOptional).toBe(true)
    expect(result.type).toBe('string')
  })

  it('should still parse prompt with relation', () => {
    const result = parseField('idea', 'What is the idea? ->Idea')

    expect(result.prompt).toBe('What is the idea?')
    expect(result.relatedType).toBe('Idea')
  })
})

// ============================================================================
// 7. Error Handling Tests
// ============================================================================

describe('parseField Error Handling', () => {
  it('should handle invalid threshold format gracefully', () => {
    // Invalid: threshold not a number
    const result = parseField('test', '~>Type(abc)')

    // Should either error or return undefined threshold
    expect(result.relatedType).toBe('Type')
  })

  it('should handle empty union type gracefully', () => {
    // Invalid: empty type in union
    const result = parseField('test', '->A||B')

    // Should handle gracefully
    expect(result.isRelation).toBe(true)
  })

  it('should handle empty backref field gracefully', () => {
    // Invalid: empty field after dot
    const result = parseField('test', '<-Order.')

    // Should handle gracefully
    expect(result.direction).toBe('backward')
  })
})

// ============================================================================
// 8. Complex Real-World Examples
// ============================================================================

describe('parseField Real-World Examples', () => {
  it('should parse CRM owner field: ->Person|Company', () => {
    const result = parseField('owner', '->Person|Company')

    expect(result.unionTypes).toEqual(['Person', 'Company'])
    expect(result.isRelation).toBe(true)
  })

  it('should parse E-commerce category: ~>Category(0.9)', () => {
    const result = parseField('category', 'Select the product category ~>Category(0.9)')

    expect(result.prompt).toBe('Select the product category')
    expect(result.threshold).toBe(0.9)
    expect(result.matchMode).toBe('fuzzy')
  })

  it('should parse Blog post comments: <-Comment.post', () => {
    const result = parseField('comments', '<-Comment.post')

    expect(result.backrefField).toBe('post')
    expect(result.relatedType).toBe('Comment')
    expect(result.direction).toBe('backward')
  })

  it('should parse Invoice line items: <-LineItem.invoice', () => {
    const result = parseField('lineItems', '<-LineItem.invoice')

    expect(result.backrefField).toBe('invoice')
    expect(result.relatedType).toBe('LineItem')
  })

  it('should parse Polymorphic attachment: ->Document|Image|Video', () => {
    const result = parseField('attachment', '->Document|Image|Video')

    expect(result.unionTypes).toEqual(['Document', 'Image', 'Video'])
  })

  it('should parse AI-classified tags: [~>Tag(0.8)]', () => {
    const result = parseField('tags', '[~>Tag(0.8)]')

    expect(result.isArray).toBe(true)
    expect(result.threshold).toBe(0.8)
    expect(result.matchMode).toBe('fuzzy')
  })
})

// ============================================================================
// 9. Type Definition Verification
// ============================================================================

describe('ParsedField Type Definition', () => {
  it('should have all expected properties in ParsedField interface', () => {
    // This tests that the interface has been properly extended
    const field: ParsedField = {
      name: 'test',
      type: 'string',
      isArray: false,
      isOptional: false,
      isRelation: true,
      relatedType: 'Type',
      operator: '->',
      direction: 'forward',
      matchMode: 'exact',
      // New properties that should exist:
      threshold: 0.9,
      unionTypes: ['A', 'B'],
      backrefField: 'field',
      prompt: 'prompt',
    }

    expect(field.threshold).toBe(0.9)
    expect(field.unionTypes).toEqual(['A', 'B'])
    expect(field.backrefField).toBe('field')
  })
})
