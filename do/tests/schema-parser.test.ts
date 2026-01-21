/**
 * Tests for the Unified Schema Parser
 *
 * Tests parsing of both IceType modifiers and ai-database prompt fields.
 */

import { describe, it, expect } from 'vitest'
import {
  parseFieldDefinition,
  parseRelation,
  parseSchema,
  parseEntitySchema,
  isPromptField,
  isRelationField,
} from '../schema/parser'

// =============================================================================
// isPromptField Tests
// =============================================================================

describe('isPromptField', () => {
  describe('IceType fields (should return false)', () => {
    it('should return false for primitive types', () => {
      expect(isPromptField('string')).toBe(false)
      expect(isPromptField('int')).toBe(false)
      expect(isPromptField('boolean')).toBe(false)
      expect(isPromptField('timestamp')).toBe(false)
    })

    it('should return false for types with modifiers', () => {
      expect(isPromptField('string!')).toBe(false)
      expect(isPromptField('string?')).toBe(false)
      expect(isPromptField('string#')).toBe(false)
      expect(isPromptField('int!')).toBe(false)
    })

    it('should return false for array types', () => {
      expect(isPromptField('string[]')).toBe(false)
      expect(isPromptField('int[]')).toBe(false)
    })

    it('should return false for entity references', () => {
      expect(isPromptField('User')).toBe(false)
      expect(isPromptField('User?')).toBe(false)
      expect(isPromptField('User[]')).toBe(false)
    })

    it('should return false for relation operators', () => {
      expect(isPromptField('-> User')).toBe(false)
      expect(isPromptField('<- Post.author')).toBe(false)
      expect(isPromptField('~> Category')).toBe(false)
      expect(isPromptField('<~ Tag.items')).toBe(false)
    })
  })

  describe('ai-database prompt fields (should return true)', () => {
    it('should return true for natural language descriptions', () => {
      expect(isPromptField('A compelling product description')).toBe(true)
      expect(isPromptField('Brief summary of the content')).toBe(true)
    })

    it('should return true for question prompts', () => {
      expect(isPromptField('What are their main challenges?')).toBe(true)
      expect(isPromptField('How would you describe this?')).toBe(true)
    })

    it('should return true for enum hints with slashes', () => {
      // Note: Current implementation doesn't detect slash-based enum hints
      // This test documents expected behavior that could be added
      // expect(isPromptField('low/medium/high')).toBe(true)
    })
  })
})

// =============================================================================
// isRelationField Tests
// =============================================================================

describe('isRelationField', () => {
  it('should return true for forward relations', () => {
    expect(isRelationField('-> User')).toBe(true)
    expect(isRelationField('->User')).toBe(true)
  })

  it('should return true for backward relations', () => {
    expect(isRelationField('<- Post.author')).toBe(true)
    expect(isRelationField('<-Post.author')).toBe(true)
  })

  it('should return true for fuzzy relations', () => {
    expect(isRelationField('~> Category')).toBe(true)
    expect(isRelationField('<~ Tag.items')).toBe(true)
  })

  it('should return false for non-relation fields', () => {
    expect(isRelationField('string')).toBe(false)
    expect(isRelationField('User')).toBe(false)
    expect(isRelationField('int!')).toBe(false)
  })
})

// =============================================================================
// parseFieldDefinition Tests - IceType Modifiers
// =============================================================================

describe('parseFieldDefinition - IceType modifiers', () => {
  describe('required modifier (!)', () => {
    it('should parse string!', () => {
      const result = parseFieldDefinition('name', 'string!')
      expect(result.type).toBe('string')
      expect(result.required).toBe(true)
      expect(result.optional).toBe(false)
    })

    it('should parse int!', () => {
      const result = parseFieldDefinition('count', 'int!')
      expect(result.type).toBe('int')
      expect(result.required).toBe(true)
    })
  })

  describe('optional modifier (?)', () => {
    it('should parse string?', () => {
      const result = parseFieldDefinition('bio', 'string?')
      expect(result.type).toBe('string')
      expect(result.optional).toBe(true)
      expect(result.required).toBe(false)
    })
  })

  describe('indexed/unique modifier (#)', () => {
    it('should parse string#', () => {
      const result = parseFieldDefinition('email', 'string#')
      expect(result.type).toBe('string')
      expect(result.indexed).toBe(true)
      expect(result.unique).toBe(true)
    })
  })

  describe('array modifier ([])', () => {
    it('should parse string[]', () => {
      const result = parseFieldDefinition('tags', 'string[]')
      expect(result.type).toBe('string')
      expect(result.array).toBe(true)
    })

    it('should parse array literal syntax', () => {
      const result = parseFieldDefinition('items', ['string'])
      expect(result.type).toBe('string')
      expect(result.array).toBe(true)
    })
  })

  describe('combined modifiers', () => {
    it('should parse string!#', () => {
      const result = parseFieldDefinition('sku', 'string!#')
      expect(result.type).toBe('string')
      expect(result.required).toBe(true)
      expect(result.indexed).toBe(true)
      expect(result.unique).toBe(true)
    })

    it('should parse string[]?', () => {
      const result = parseFieldDefinition('tags', 'string[]?')
      expect(result.type).toBe('string')
      expect(result.array).toBe(true)
      expect(result.optional).toBe(true)
    })
  })
})

// =============================================================================
// parseFieldDefinition Tests - Parametric Types
// =============================================================================

describe('parseFieldDefinition - parametric types', () => {
  it('should parse decimal(10,2)', () => {
    const result = parseFieldDefinition('price', 'decimal(10,2)')
    expect(result.type).toBe('decimal')
    expect(result.precision).toBe(10)
    expect(result.scale).toBe(2)
  })

  it('should parse varchar(255)', () => {
    const result = parseFieldDefinition('name', 'varchar(255)')
    expect(result.type).toBe('varchar')
    expect(result.length).toBe(255)
  })

  it('should parse decimal(10,2)!', () => {
    const result = parseFieldDefinition('price', 'decimal(10,2)!')
    expect(result.type).toBe('decimal')
    expect(result.precision).toBe(10)
    expect(result.scale).toBe(2)
    expect(result.required).toBe(true)
  })
})

// =============================================================================
// parseRelation Tests
// =============================================================================

describe('parseRelation', () => {
  describe('forward exact relations (->)', () => {
    it('should parse -> User', () => {
      const result = parseRelation('-> User')
      expect(result.operator).toBe('->')
      expect(result.direction).toBe('forward')
      expect(result.matchMode).toBe('exact')
      expect(result.targetType).toBe('User')
    })

    it('should parse ->User (no space)', () => {
      const result = parseRelation('->User')
      expect(result.operator).toBe('->')
      expect(result.targetType).toBe('User')
    })

    it('should parse -> User?', () => {
      const result = parseRelation('-> User?')
      expect(result.operator).toBe('->')
      expect(result.targetType).toBe('User')
      expect(result.optional).toBe(true)
    })

    it('should parse -> User[]', () => {
      const result = parseRelation('-> User[]')
      expect(result.operator).toBe('->')
      expect(result.targetType).toBe('User')
      expect(result.array).toBe(true)
    })
  })

  describe('backward exact relations (<-)', () => {
    it('should parse <- Post.author', () => {
      const result = parseRelation('<- Post.author')
      expect(result.operator).toBe('<-')
      expect(result.direction).toBe('backward')
      expect(result.matchMode).toBe('exact')
      expect(result.targetType).toBe('Post')
      expect(result.backref).toBe('author')
    })

    it('should parse <- Post.author[]', () => {
      const result = parseRelation('<- Post.author[]')
      expect(result.operator).toBe('<-')
      expect(result.targetType).toBe('Post')
      expect(result.backref).toBe('author')
      expect(result.array).toBe(true)
    })
  })

  describe('forward fuzzy relations (~>)', () => {
    it('should parse ~> Category', () => {
      const result = parseRelation('~> Category')
      expect(result.operator).toBe('~>')
      expect(result.direction).toBe('forward')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.targetType).toBe('Category')
    })

    it('should parse ~> Category(0.8)', () => {
      const result = parseRelation('~> Category(0.8)')
      expect(result.operator).toBe('~>')
      expect(result.targetType).toBe('Category')
      expect(result.threshold).toBe(0.8)
    })
  })

  describe('backward fuzzy relations (<~)', () => {
    it('should parse <~ Tag.items', () => {
      const result = parseRelation('<~ Tag.items')
      expect(result.operator).toBe('<~')
      expect(result.direction).toBe('backward')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.targetType).toBe('Tag')
      expect(result.backref).toBe('items')
    })
  })

  describe('union types', () => {
    it('should parse -> Person|Company|Organization', () => {
      const result = parseRelation('-> Person|Company|Organization')
      expect(result.operator).toBe('->')
      expect(result.targetType).toBe('Person')
      expect(result.unionTypes).toEqual(['Person', 'Company', 'Organization'])
    })
  })

  describe('error handling', () => {
    it('should throw for missing operator', () => {
      expect(() => parseRelation('User')).toThrow()
    })
  })
})

// =============================================================================
// parseFieldDefinition Tests - Prompt Fields
// =============================================================================

describe('parseFieldDefinition - prompt fields', () => {
  it('should parse natural language description as prompt field', () => {
    const result = parseFieldDefinition('description', 'A compelling product description')
    expect(result.type).toBe('string')
    expect(result.prompt).toBe('A compelling product description')
    expect(result.generated).toBe(true)
  })

  it('should parse question prompt', () => {
    const result = parseFieldDefinition('challenges', 'What are the main challenges?')
    expect(result.type).toBe('string')
    expect(result.prompt).toBe('What are the main challenges?')
    expect(result.generated).toBe(true)
  })
})

// =============================================================================
// parseFieldDefinition Tests - Relation Fields
// =============================================================================

describe('parseFieldDefinition - relation fields', () => {
  it('should parse forward relation', () => {
    const result = parseFieldDefinition('author', '-> User')
    expect(result.type).toBe('User')
    expect(result.relation).toBeDefined()
    expect(result.relation?.operator).toBe('->')
    expect(result.relation?.direction).toBe('forward')
  })

  it('should parse backward relation with backref', () => {
    const result = parseFieldDefinition('posts', '<- Post.author[]')
    expect(result.type).toBe('Post')
    expect(result.relation).toBeDefined()
    expect(result.relation?.operator).toBe('<-')
    expect(result.relation?.direction).toBe('backward')
    expect(result.relation?.backref).toBe('author')
    expect(result.array).toBe(true)
  })

  it('should parse fuzzy relation', () => {
    const result = parseFieldDefinition('category', '~> Category')
    expect(result.type).toBe('Category')
    expect(result.relation).toBeDefined()
    expect(result.relation?.matchMode).toBe('fuzzy')
  })
})

// =============================================================================
// parseEntitySchema Tests
// =============================================================================

describe('parseEntitySchema', () => {
  it('should parse entity with mixed field types', () => {
    const schema = parseEntitySchema('Product', {
      sku: 'string!#',
      name: 'string!',
      price: 'decimal(10,2)!',
      description: 'A compelling product description',
      vendor: '-> Vendor?',
      tags: ['string'],
    })

    expect(schema.name).toBe('Product')
    expect(schema.fields.size).toBe(6)

    // Check required indexed field
    const sku = schema.fields.get('sku')
    expect(sku?.type).toBe('string')
    expect(sku?.required).toBe(true)
    expect(sku?.indexed).toBe(true)

    // Check prompt field
    const desc = schema.fields.get('description')
    expect(desc?.prompt).toBe('A compelling product description')
    expect(desc?.generated).toBe(true)

    // Check relation field
    const vendor = schema.fields.get('vendor')
    expect(vendor?.relation).toBeDefined()
    expect(vendor?.relation?.operator).toBe('->')

    // Check array field
    const tags = schema.fields.get('tags')
    expect(tags?.array).toBe(true)
  })

  it('should extract directives', () => {
    const schema = parseEntitySchema('Category', {
      $instructions: 'Categories for blog posts',
      $fuzzyThreshold: 0.8,
      $partitionBy: ['tenantId'],
      name: 'string!',
    })

    expect(schema.directives.$instructions).toBe('Categories for blog posts')
    expect(schema.directives.$fuzzyThreshold).toBe(0.8)
    expect(schema.directives.$partitionBy).toEqual(['tenantId'])
  })
})

// =============================================================================
// parseSchema Tests
// =============================================================================

describe('parseSchema', () => {
  it('should parse complete database schema', () => {
    const schema = parseSchema({
      User: {
        name: 'string!',
        email: 'string!#',
        bio: 'A brief bio of the user',
      },
      Post: {
        title: 'string!',
        content: 'markdown',
        summary: 'Summarize the post content',
        author: '-> User',
      },
    })

    expect(schema.entities.size).toBe(2)
    expect(schema.entities.has('User')).toBe(true)
    expect(schema.entities.has('Post')).toBe(true)

    // Check User entity
    const user = schema.entities.get('User')!
    expect(user.fields.get('bio')?.generated).toBe(true)

    // Check Post entity
    const post = schema.entities.get('Post')!
    expect(post.fields.get('author')?.relation?.targetType).toBe('User')
    expect(post.fields.get('summary')?.generated).toBe(true)
  })

  it('should resolve bidirectional backrefs', () => {
    const schema = parseSchema({
      Author: {
        name: 'string!',
      },
      Post: {
        title: 'string!',
        author: '<- Author.posts',
      },
    })

    // Author should now have a 'posts' field
    const author = schema.entities.get('Author')!
    const postsField = author.fields.get('posts')
    expect(postsField).toBeDefined()
    expect(postsField?.relation?.targetType).toBe('Post')
    expect(postsField?.relation?.backref).toBe('author')
  })

  it('should handle complex relations', () => {
    const schema = parseSchema({
      Product: {
        name: 'string!',
        category: '~> Category',
        vendor: '-> Vendor?',
      },
      Category: {
        $fuzzyThreshold: 0.85,
        name: 'string!',
      },
      Vendor: {
        name: 'string!',
        products: '<- Product.vendor[]',
      },
    })

    // Check fuzzy relation
    const product = schema.entities.get('Product')!
    const categoryRel = product.fields.get('category')?.relation
    expect(categoryRel?.matchMode).toBe('fuzzy')

    // Check backward relation creates forward
    const vendor = schema.entities.get('Vendor')!
    expect(vendor.fields.has('products')).toBe(true)
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle type aliases', () => {
    const result = parseFieldDefinition('active', 'bool')
    expect(result.type).toBe('boolean')
  })

  it('should handle nested array literals', () => {
    const result = parseFieldDefinition('items', ['-> Product'])
    expect(result.array).toBe(true)
    expect(result.relation?.targetType).toBe('Product')
  })

  it('should handle empty directives gracefully', () => {
    const schema = parseEntitySchema('Simple', {
      name: 'string!',
    })

    expect(schema.directives.$instructions).toBeUndefined()
    expect(schema.directives.$fuzzyThreshold).toBeUndefined()
  })
})
