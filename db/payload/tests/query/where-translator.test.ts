import { describe, it, expect } from 'vitest'
import {
  translateWhere,
  translateWhereClauseOnly,
  toJsonPath,
  validateFieldPath,
  WhereTranslatorError,
  type WhereClause,
  type FieldCondition,
} from '../../src/query/where-translator'

/**
 * Where Translator Tests
 *
 * Tests for translating Payload CMS where clauses to SQLite json_extract() queries
 * for the Things table.
 *
 * @see dotdo-r3z58 - Payload where clause to Things JSON query translator
 */

// ============================================================================
// PATH VALIDATION TESTS
// ============================================================================

describe('validateFieldPath', () => {
  describe('valid paths', () => {
    it('should accept simple field names', () => {
      expect(() => validateFieldPath('title')).not.toThrow()
      expect(() => validateFieldPath('status')).not.toThrow()
      expect(() => validateFieldPath('_id')).not.toThrow()
    })

    it('should accept nested paths', () => {
      expect(() => validateFieldPath('author.name')).not.toThrow()
      expect(() => validateFieldPath('meta.featured')).not.toThrow()
      expect(() => validateFieldPath('settings.display.theme')).not.toThrow()
    })

    it('should accept paths with array indices', () => {
      expect(() => validateFieldPath('tags.0')).not.toThrow()
      expect(() => validateFieldPath('items.5.name')).not.toThrow()
      expect(() => validateFieldPath('blocks.0.content.text')).not.toThrow()
    })

    it('should accept paths with underscores', () => {
      expect(() => validateFieldPath('first_name')).not.toThrow()
      expect(() => validateFieldPath('user_profile.display_name')).not.toThrow()
    })

    it('should accept alphanumeric field names', () => {
      expect(() => validateFieldPath('field1')).not.toThrow()
      expect(() => validateFieldPath('item2.value3')).not.toThrow()
    })
  })

  describe('invalid paths', () => {
    it('should reject empty paths', () => {
      expect(() => validateFieldPath('')).toThrow('Field path cannot be empty')
      expect(() => validateFieldPath(null as any)).toThrow('Field path cannot be empty')
      expect(() => validateFieldPath(undefined as any)).toThrow('Field path cannot be empty')
    })

    it('should reject paths starting with a dot', () => {
      expect(() => validateFieldPath('.field')).toThrow('Field path cannot start with a dot')
      expect(() => validateFieldPath('.nested.path')).toThrow('Field path cannot start with a dot')
    })

    it('should reject paths ending with a dot', () => {
      expect(() => validateFieldPath('field.')).toThrow('Field path cannot end with a dot')
      expect(() => validateFieldPath('nested.path.')).toThrow('Field path cannot end with a dot')
    })

    it('should reject paths with consecutive dots', () => {
      expect(() => validateFieldPath('field..nested')).toThrow('Field path cannot contain consecutive dots')
      expect(() => validateFieldPath('a...b')).toThrow('Field path cannot contain consecutive dots')
    })

    it('should reject paths with SQL injection attempts', () => {
      // These should throw because they contain invalid characters
      expect(() => validateFieldPath("field'; DROP TABLE things;--")).toThrow()
      expect(() => validateFieldPath('field" OR "1"="1')).toThrow()
      expect(() => validateFieldPath('field); DELETE FROM things;')).toThrow()
    })

    it('should reject paths with special characters', () => {
      expect(() => validateFieldPath('field-name')).toThrow()
      expect(() => validateFieldPath('field name')).toThrow()
      expect(() => validateFieldPath('field@name')).toThrow()
      expect(() => validateFieldPath('field$name')).toThrow()
    })
  })
})

// ============================================================================
// JSON PATH CONVERSION TESTS
// ============================================================================

describe('toJsonPath', () => {
  it('should convert simple field names', () => {
    expect(toJsonPath('title')).toBe('$.title')
    expect(toJsonPath('status')).toBe('$.status')
    expect(toJsonPath('name')).toBe('$.name')
  })

  it('should convert nested object paths', () => {
    expect(toJsonPath('author.name')).toBe('$.author.name')
    expect(toJsonPath('meta.featured')).toBe('$.meta.featured')
    expect(toJsonPath('settings.display.theme')).toBe('$.settings.display.theme')
    expect(toJsonPath('a.b.c.d.e')).toBe('$.a.b.c.d.e')
  })

  it('should convert array indices to bracket notation', () => {
    expect(toJsonPath('tags.0')).toBe('$.tags[0]')
    expect(toJsonPath('items.5')).toBe('$.items[5]')
    expect(toJsonPath('blocks.10')).toBe('$.blocks[10]')
  })

  it('should handle mixed object and array paths', () => {
    expect(toJsonPath('blocks.0.content')).toBe('$.blocks[0].content')
    expect(toJsonPath('data.items.0.name')).toBe('$.data.items[0].name')
    expect(toJsonPath('a.0.b.1.c')).toBe('$.a[0].b[1].c')
    expect(toJsonPath('posts.0.comments.2.author.name')).toBe('$.posts[0].comments[2].author.name')
  })
})

// ============================================================================
// SIMPLE FIELD CONDITIONS TESTS
// ============================================================================

describe('translateWhere - simple field conditions', () => {
  const typeId = 1

  describe('equals operator', () => {
    it('should translate equals for string values', () => {
      const where: WhereClause = { title: { equals: 'Hello World' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(typeId)
      expect(result.params).toContain('Hello World')
    })

    it('should translate equals for number values', () => {
      const where: WhereClause = { views: { equals: 100 } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(100)
    })

    it('should translate equals for boolean values', () => {
      const where: WhereClause = { featured: { equals: true } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(true)
    })

    it('should translate equals for null values (IS NULL)', () => {
      const where: WhereClause = { deletedAt: { equals: null } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // null checks don't add params, they use IS NULL
      expect(result.params.length).toBe(1) // only typeId
    })

    it('should translate equals for undefined values (IS NULL)', () => {
      const where: WhereClause = { deletedAt: { equals: undefined } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
    })
  })

  describe('not_equals operator', () => {
    it('should translate not_equals for string values', () => {
      const where: WhereClause = { status: { not_equals: 'draft' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('draft')
    })

    it('should translate not_equals for null values (IS NOT NULL)', () => {
      const where: WhereClause = { deletedAt: { not_equals: null } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params.length).toBe(1) // only typeId
    })
  })

  describe('in operator', () => {
    it('should translate in with string array', () => {
      const where: WhereClause = { status: { in: ['draft', 'published', 'archived'] } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('draft')
      expect(result.params).toContain('published')
      expect(result.params).toContain('archived')
    })

    it('should translate in with number array', () => {
      const where: WhereClause = { priority: { in: [1, 2, 3] } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(1)
      expect(result.params).toContain(2)
      expect(result.params).toContain(3)
    })

    it('should handle empty in array (always false)', () => {
      const where: WhereClause = { status: { in: [] } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // Empty IN produces 1 = 0 which is always false
    })

    it('should throw for non-array in value', () => {
      const where = { status: { in: 'not-an-array' } } as unknown as WhereClause

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
      expect(() => translateWhere(where, typeId)).toThrow("'in' operator requires an array value")
    })
  })

  describe('not_in operator', () => {
    it('should translate not_in with array', () => {
      const where: WhereClause = { status: { not_in: ['deleted', 'spam'] } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('deleted')
      expect(result.params).toContain('spam')
    })

    it('should handle empty not_in array (no effect)', () => {
      const where: WhereClause = { status: { not_in: [] } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // Empty NOT IN is always true - should only have typeId condition
    })

    it('should throw for non-array not_in value', () => {
      const where = { status: { not_in: 'not-an-array' } } as unknown as WhereClause

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
      expect(() => translateWhere(where, typeId)).toThrow("'not_in' operator requires an array value")
    })
  })

  describe('comparison operators', () => {
    it('should translate greater_than', () => {
      const where: WhereClause = { views: { greater_than: 100 } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(100)
    })

    it('should translate greater_than_equal', () => {
      const where: WhereClause = { views: { greater_than_equal: 100 } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(100)
    })

    it('should translate less_than', () => {
      const where: WhereClause = { stock: { less_than: 10 } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(10)
    })

    it('should translate less_than_equal', () => {
      const where: WhereClause = { rating: { less_than_equal: 3.5 } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(3.5)
    })

    it('should handle date comparisons', () => {
      const where: WhereClause = { createdAt: { greater_than: '2024-01-01T00:00:00Z' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('2024-01-01T00:00:00Z')
    })

    it('should handle range queries (multiple operators on same field)', () => {
      const where: WhereClause = {
        price: {
          greater_than_equal: 10,
          less_than: 100,
        },
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain(10)
      expect(result.params).toContain(100)
    })
  })

  describe('string pattern operators', () => {
    it('should translate like operator', () => {
      const where: WhereClause = { title: { like: '%introduction%' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('%introduction%')
    })

    it('should translate contains operator (wraps with %)', () => {
      const where: WhereClause = { description: { contains: 'important' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('%important%')
    })

    it('should throw for non-string like value', () => {
      const where = { title: { like: 123 } } as unknown as WhereClause

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
      expect(() => translateWhere(where, typeId)).toThrow("'like' operator requires a string value")
    })

    it('should throw for non-string contains value', () => {
      const where = { title: { contains: 123 } } as unknown as WhereClause

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
      expect(() => translateWhere(where, typeId)).toThrow("'contains' operator requires a string value")
    })
  })

  describe('exists operator', () => {
    it('should translate exists: true (IS NOT NULL)', () => {
      const where: WhereClause = { metadata: { exists: true } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // exists doesn't add to params
    })

    it('should translate exists: false (IS NULL)', () => {
      const where: WhereClause = { metadata: { exists: false } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
    })

    it('should throw for non-boolean exists value', () => {
      const where = { metadata: { exists: 'yes' } } as unknown as WhereClause

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
      expect(() => translateWhere(where, typeId)).toThrow("'exists' operator requires a boolean value")
    })
  })
})

// ============================================================================
// NESTED FIELD PATH TESTS
// ============================================================================

describe('translateWhere - nested field paths', () => {
  const typeId = 1

  it('should handle single-level nested paths', () => {
    const where: WhereClause = { 'author.name': { equals: 'John' } }
    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain('John')
  })

  it('should handle deeply nested paths', () => {
    const where: WhereClause = { 'settings.display.theme.mode': { equals: 'dark' } }
    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain('dark')
  })

  it('should handle array index paths', () => {
    const where: WhereClause = { 'tags.0': { equals: 'featured' } }
    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain('featured')
  })

  it('should handle mixed object and array paths', () => {
    const where: WhereClause = { 'blocks.0.content.text': { contains: 'hello' } }
    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain('%hello%')
  })

  it('should handle nested paths with all operators', () => {
    const where: WhereClause = {
      'meta.views': { greater_than: 100 },
      'meta.likes': { greater_than_equal: 10 },
      'author.verified': { equals: true },
      'tags.0': { in: ['featured', 'trending'] },
    }
    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain(100)
    expect(result.params).toContain(10)
    expect(result.params).toContain(true)
  })
})

// ============================================================================
// COMPOUND QUERY TESTS (AND/OR)
// ============================================================================

describe('translateWhere - compound queries', () => {
  const typeId = 1

  describe('AND logic', () => {
    it('should combine explicit AND conditions', () => {
      const where: WhereClause = {
        and: [
          { status: { equals: 'published' } },
          { featured: { equals: true } },
        ],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('published')
      expect(result.params).toContain(true)
    })

    it('should implicitly AND multiple top-level fields', () => {
      const where: WhereClause = {
        status: { equals: 'published' },
        featured: { equals: true },
        views: { greater_than: 100 },
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('published')
      expect(result.params).toContain(true)
      expect(result.params).toContain(100)
    })

    it('should handle empty AND array', () => {
      const where: WhereClause = { and: [] }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // Only typeId condition should remain
      expect(result.params).toEqual([typeId])
    })
  })

  describe('OR logic', () => {
    it('should combine explicit OR conditions', () => {
      const where: WhereClause = {
        or: [
          { status: { equals: 'published' } },
          { status: { equals: 'featured' } },
        ],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('published')
      expect(result.params).toContain('featured')
    })

    it('should handle empty OR array (always false)', () => {
      const where: WhereClause = { or: [] }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // Empty OR is always false (1 = 0)
    })
  })

  describe('nested AND/OR', () => {
    it('should handle nested AND inside OR', () => {
      const where: WhereClause = {
        or: [
          { status: { equals: 'published' } },
          {
            and: [
              { status: { equals: 'draft' } },
              { featured: { equals: true } },
            ],
          },
        ],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('published')
      expect(result.params).toContain('draft')
      expect(result.params).toContain(true)
    })

    it('should handle nested OR inside AND', () => {
      const where: WhereClause = {
        and: [
          { type: { equals: 'post' } },
          {
            or: [
              { status: { equals: 'published' } },
              { featured: { equals: true } },
            ],
          },
        ],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('post')
      expect(result.params).toContain('published')
      expect(result.params).toContain(true)
    })

    it('should handle deeply nested logical operators', () => {
      const where: WhereClause = {
        and: [
          { type: { equals: 'post' } },
          {
            or: [
              { status: { equals: 'published' } },
              {
                and: [
                  { featured: { equals: true } },
                  { priority: { greater_than: 5 } },
                ],
              },
            ],
          },
        ],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('post')
      expect(result.params).toContain('published')
      expect(result.params).toContain(true)
      expect(result.params).toContain(5)
    })

    it('should handle complex mixed conditions', () => {
      const where: WhereClause = {
        status: { not_equals: 'deleted' }, // Top-level (implicit AND)
        and: [
          { type: { in: ['post', 'article'] } },
        ],
        or: [
          { featured: { equals: true } },
          { priority: { greater_than_equal: 10 } },
        ],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('deleted')
      expect(result.params).toContain('post')
      expect(result.params).toContain('article')
      expect(result.params).toContain(true)
      expect(result.params).toContain(10)
    })
  })
})

// ============================================================================
// EDGE CASES TESTS
// ============================================================================

describe('translateWhere - edge cases', () => {
  const typeId = 1

  describe('null and undefined handling', () => {
    it('should handle null equality check', () => {
      const where: WhereClause = { deletedAt: { equals: null } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
    })

    it('should handle undefined equality check', () => {
      const where: WhereClause = { deletedAt: { equals: undefined } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
    })

    it('should handle null inequality check', () => {
      const where: WhereClause = { deletedAt: { not_equals: null } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
    })

    it('should skip undefined operator values', () => {
      const where: WhereClause = {
        status: { equals: 'published', in: undefined as any },
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('published')
    })
  })

  describe('special characters in values', () => {
    it('should handle special characters in string values', () => {
      const where: WhereClause = { title: { equals: "Test's \"quoted\" value" } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain("Test's \"quoted\" value")
    })

    it('should handle unicode in values', () => {
      const where: WhereClause = { name: { equals: 'Test Unicode: - - -' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('Test Unicode: - - -')
    })

    it('should handle SQL injection attempts in VALUES (safely)', () => {
      // Values are parameterized, so SQL injection in values is safe
      const where: WhereClause = { title: { equals: "'; DROP TABLE things; --" } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain("'; DROP TABLE things; --")
      // The value is parameterized, not interpolated into SQL
    })
  })

  describe('SQL injection prevention in field paths', () => {
    it('should reject SQL injection in field paths', () => {
      const where: WhereClause = {
        "field'; DROP TABLE things;--": { equals: 'value' },
      }

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
    })

    it('should reject field paths with quotes', () => {
      const where: WhereClause = {
        'field"name': { equals: 'value' },
      }

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
    })

    it('should reject field paths with parentheses', () => {
      const where: WhereClause = {
        'field()name': { equals: 'value' },
      }

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
    })

    it('should reject field paths with semicolons', () => {
      const where: WhereClause = {
        'field;name': { equals: 'value' },
      }

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
    })
  })

  describe('unknown operators', () => {
    it('should throw for unknown operators', () => {
      const where = { status: { unknown_op: 'value' } } as unknown as WhereClause

      expect(() => translateWhere(where, typeId)).toThrow(WhereTranslatorError)
      expect(() => translateWhere(where, typeId)).toThrow('Unknown operator')
    })
  })

  describe('empty conditions', () => {
    it('should handle empty field condition object', () => {
      const where: WhereClause = { status: {} }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      // Only typeId condition should remain
      expect(result.params).toEqual([typeId])
    })

    it('should handle multiple empty conditions', () => {
      const where: WhereClause = {
        status: {},
        title: {},
        and: [],
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toEqual([typeId])
    })
  })

  describe('very long paths', () => {
    it('should handle very long field paths', () => {
      const where: WhereClause = {
        'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p': { equals: 'deep' },
      }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('deep')
    })
  })

  describe('numeric string values', () => {
    it('should preserve numeric strings as strings', () => {
      const where: WhereClause = { code: { equals: '001' } }
      const result = translateWhere(where, typeId)

      expect(result.sql).toBeDefined()
      expect(result.params).toContain('001')
    })
  })
})

// ============================================================================
// ALL OPERATORS TESTS
// ============================================================================

describe('translateWhere - all operators', () => {
  const typeId = 1

  it('should correctly translate all operators in one query', () => {
    const where: WhereClause = {
      // equals
      status: { equals: 'published' },
      // not_equals
      type: { not_equals: 'deleted' },
      // in
      category: { in: ['tech', 'science'] },
      // not_in
      tag: { not_in: ['spam', 'test'] },
      // greater_than
      views: { greater_than: 100 },
      // greater_than_equal
      likes: { greater_than_equal: 10 },
      // less_than
      bounceRate: { less_than: 50 },
      // less_than_equal
      errorCount: { less_than_equal: 5 },
      // like
      title: { like: '%tutorial%' },
      // contains
      description: { contains: 'guide' },
      // exists
      metadata: { exists: true },
    }
    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()

    // Verify all values are in params
    expect(result.params).toContain('published')
    expect(result.params).toContain('deleted')
    expect(result.params).toContain('tech')
    expect(result.params).toContain('science')
    expect(result.params).toContain('spam')
    expect(result.params).toContain('test')
    expect(result.params).toContain(100)
    expect(result.params).toContain(10)
    expect(result.params).toContain(50)
    expect(result.params).toContain(5)
    expect(result.params).toContain('%tutorial%')
    expect(result.params).toContain('%guide%')
  })
})

// ============================================================================
// translateWhereClauseOnly TESTS
// ============================================================================

describe('translateWhereClauseOnly', () => {
  it('should translate without type filter', () => {
    const where: WhereClause = { status: { equals: 'published' } }
    const result = translateWhereClauseOnly(where)

    expect(result).toBeDefined()
    expect(result!.sql).toBeDefined()
    expect(result!.params).toContain('published')
    // Should NOT contain typeId
    expect(result!.params.length).toBe(1)
  })

  it('should return undefined for empty where clause', () => {
    const result = translateWhereClauseOnly({})
    expect(result).toBeUndefined()
  })

  it('should return undefined for undefined where clause', () => {
    const result = translateWhereClauseOnly(undefined)
    expect(result).toBeUndefined()
  })

  it('should handle complex queries without type filter', () => {
    const where: WhereClause = {
      or: [
        { status: { equals: 'published' } },
        { featured: { equals: true } },
      ],
    }
    const result = translateWhereClauseOnly(where)

    expect(result).toBeDefined()
    expect(result!.params).toContain('published')
    expect(result!.params).toContain(true)
  })
})

// ============================================================================
// OPTIONS TESTS
// ============================================================================

describe('translateWhere - options', () => {
  const typeId = 1

  it('should accept custom dataColumn option', () => {
    const where: WhereClause = { status: { equals: 'published' } }
    const result = translateWhere(where, typeId, { dataColumn: 'json_data' })

    // Should not throw and return valid result
    expect(result.sql).toBeDefined()
    expect(result.params).toContain('published')
  })

  it('should accept table alias option', () => {
    const where: WhereClause = { status: { equals: 'published' } }
    const result = translateWhere(where, typeId, { tableAlias: 't' })

    // Should not throw and return valid result
    expect(result.sql).toBeDefined()
    expect(result.params).toContain('published')
  })

  it('should accept both custom dataColumn and table alias options', () => {
    const where: WhereClause = { status: { equals: 'published' } }
    const result = translateWhere(where, typeId, {
      dataColumn: 'json_data',
      tableAlias: 't',
    })

    // Should not throw and return valid result
    expect(result.sql).toBeDefined()
    expect(result.params).toContain('published')
  })
})

// ============================================================================
// ERROR CLASS TESTS
// ============================================================================

describe('WhereTranslatorError', () => {
  it('should create error with field information', () => {
    const error = new WhereTranslatorError('Invalid operator', 'status', 'unknown_op')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(WhereTranslatorError)
    expect(error.name).toBe('WhereTranslatorError')
    expect(error.field).toBe('status')
    expect(error.operator).toBe('unknown_op')
    expect(error.message).toContain('Invalid operator')
    expect(error.message).toContain('Field: status')
    expect(error.message).toContain('Operator: unknown_op')
  })

  it('should work without operator', () => {
    const error = new WhereTranslatorError('Field validation failed', 'meta.invalid')

    expect(error.field).toBe('meta.invalid')
    expect(error.operator).toBeUndefined()
    expect(error.message).toContain('Field: meta.invalid')
    expect(error.message).not.toContain('Operator:')
  })
})

// ============================================================================
// INTEGRATION-STYLE TESTS
// ============================================================================

describe('translateWhere - integration scenarios', () => {
  const typeId = 1

  it('should translate the example from the issue description', () => {
    const where: WhereClause = {
      title: { equals: 'Hello' },
      status: { in: ['draft', 'published'] },
      views: { greater_than: 100 },
      'author.name': { contains: 'John' },
      or: [
        { status: { equals: 'published' } },
        { featured: { equals: true } },
      ],
    }

    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain(typeId)
    expect(result.params).toContain('Hello')
    expect(result.params).toContain('draft')
    expect(result.params).toContain('published')
    expect(result.params).toContain(100)
    expect(result.params).toContain('%John%')
    expect(result.params).toContain(true)
  })

  it('should handle a realistic blog post query', () => {
    const where: WhereClause = {
      _status: { equals: 'published' },
      publishedAt: { less_than_equal: '2024-12-31T23:59:59Z' },
      or: [
        { 'categories.0': { equals: 'technology' } },
        { 'tags.0': { in: ['featured', 'trending'] } },
      ],
      'author.verified': { equals: true },
    }

    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain('published')
    expect(result.params).toContain('2024-12-31T23:59:59Z')
    expect(result.params).toContain('technology')
    expect(result.params).toContain('featured')
    expect(result.params).toContain('trending')
    expect(result.params).toContain(true)
  })

  it('should handle an e-commerce product filter query', () => {
    const where: WhereClause = {
      and: [
        { available: { equals: true } },
        { stock: { greater_than: 0 } },
        { price: { greater_than_equal: 10, less_than_equal: 100 } },
      ],
      or: [
        { 'category.slug': { equals: 'electronics' } },
        { 'brand.name': { in: ['Apple', 'Samsung', 'Sony'] } },
      ],
      'meta.featured': { equals: true },
    }

    const result = translateWhere(where, typeId)

    expect(result.sql).toBeDefined()
    expect(result.params).toContain(true) // available, featured
    expect(result.params).toContain(0) // stock > 0
    expect(result.params).toContain(10) // price >= 10
    expect(result.params).toContain(100) // price <= 100
    expect(result.params).toContain('electronics')
    expect(result.params).toContain('Apple')
    expect(result.params).toContain('Samsung')
    expect(result.params).toContain('Sony')
  })
})
