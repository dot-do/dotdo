/**
 * Tests for the Centralized Schema Parser
 *
 * Validates:
 * - Operator parsing consistency
 * - Rich error messages with hints
 * - Schema validation at parse time
 * - Circular reference detection
 * - Schema caching
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SchemaParser,
  createSchemaParser,
  defaultParser,
  parseOperatorReference,
  CascadeSchemaError,
  CircularReferenceError,
  PRIMITIVE_TYPES,
} from '../schema-parser'

// ============================================================================
// PARSER CONFIGURATION
// ============================================================================

describe('SchemaParser Configuration', () => {
  describe('createSchemaParser()', () => {
    it('creates a parser with default configuration', () => {
      const parser = createSchemaParser()
      expect(parser).toBeInstanceOf(SchemaParser)
    })

    it('allows custom operator configuration', () => {
      const parser = createSchemaParser({
        operators: ['->', '<-'],
      })

      // These should work
      expect(parser.parseReference('->User')).not.toBeNull()
      expect(parser.parseReference('<-Post')).not.toBeNull()

      // Fuzzy operators should NOT work with this config
      expect(parser.parseReference('~>Tag')).toBeNull()
      expect(parser.parseReference('<~Article')).toBeNull()
    })

    it('allows custom type pattern', () => {
      const parser = createSchemaParser({
        typePattern: /^[a-z][a-zA-Z]*$/,
        strict: true,
      })

      // PascalCase should fail in strict mode with this pattern
      expect(() => parser.parseReference('->User')).toThrow(CascadeSchemaError)

      // camelCase should work
      const result = parser.parseReference('->user')
      expect(result?.target).toBe('user')
    })

    it('allows custom array pattern', () => {
      const parser = createSchemaParser({
        arrayPattern: /<>$/,
      })

      // Standard [] should not be treated as array
      const result1 = parser.parseReference('->User[]')
      expect(result1?.target).toBe('User[]')
      expect(result1?.isArray).toBeFalsy()

      // Custom <> should be treated as array
      const result2 = parser.parseReference('->User<>')
      expect(result2?.target).toBe('User')
      expect(result2?.isArray).toBe(true)
    })
  })

  describe('default parser', () => {
    it('is available as a singleton', () => {
      expect(defaultParser).toBeInstanceOf(SchemaParser)
    })

    it('parseOperatorReference() uses default parser', () => {
      const result = parseOperatorReference('->User')
      expect(result?.target).toBe('User')
    })
  })
})

// ============================================================================
// OPERATOR PARSING
// ============================================================================

describe('Operator Parsing', () => {
  describe('Forward Exact (->) Operator', () => {
    it('parses simple forward reference', () => {
      const result = defaultParser.parseReference('->User')
      expect(result).toEqual({
        operator: '->',
        direction: 'forward',
        mode: 'exact',
        target: 'User',
      })
    })

    it('parses with optional modifier', () => {
      const result = defaultParser.parseReference('->User?')
      expect(result?.isOptional).toBe(true)
    })

    it('parses with array modifier', () => {
      const result = defaultParser.parseReference('->User[]')
      expect(result?.isArray).toBe(true)
    })

    it('parses with both array and optional modifiers', () => {
      const result = defaultParser.parseReference('->User[]?')
      expect(result?.isArray).toBe(true)
      expect(result?.isOptional).toBe(true)
    })

    it('parses union types', () => {
      const result = defaultParser.parseReference('->User|Org')
      expect(result?.target).toBe('User')
      expect(result?.targets).toEqual(['User', 'Org'])
    })
  })

  describe('Forward Fuzzy (~>) Operator', () => {
    it('parses fuzzy forward reference', () => {
      const result = defaultParser.parseReference('~>Category')
      expect(result).toEqual({
        operator: '~>',
        direction: 'forward',
        mode: 'fuzzy',
        target: 'Category',
      })
    })
  })

  describe('Backward Exact (<-) Operator', () => {
    it('parses backward reference', () => {
      const result = defaultParser.parseReference('<-Post')
      expect(result).toEqual({
        operator: '<-',
        direction: 'backward',
        mode: 'exact',
        target: 'Post',
      })
    })
  })

  describe('Backward Fuzzy (<~) Operator', () => {
    it('parses fuzzy backward reference', () => {
      const result = defaultParser.parseReference('<~Article')
      expect(result).toEqual({
        operator: '<~',
        direction: 'backward',
        mode: 'fuzzy',
        target: 'Article',
      })
    })
  })

  describe('Prompt Extraction', () => {
    it('extracts prompt before operator', () => {
      const result = defaultParser.parseReference('What is the idea? <-Idea')
      expect(result?.prompt).toBe('What is the idea?')
      expect(result?.target).toBe('Idea')
    })

    it('handles multi-line prompts', () => {
      const result = defaultParser.parseReference('First line\nSecond line ->Target')
      expect(result?.prompt).toBe('First line\nSecond line')
    })

    it('handles empty prompt', () => {
      const result = defaultParser.parseReference('->User')
      expect(result?.prompt).toBeUndefined()
    })
  })

  describe('Non-Reference Strings', () => {
    it('returns null for plain string', () => {
      expect(defaultParser.parseReference('What is the concept?')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(defaultParser.parseReference('')).toBeNull()
    })

    it('returns null for URL-like strings', () => {
      expect(defaultParser.parseReference('https://example.com')).toBeNull()
    })
  })
})

// ============================================================================
// ERROR MESSAGES
// ============================================================================

describe('Rich Error Messages', () => {
  describe('CascadeSchemaError', () => {
    it('includes field and type context', () => {
      const error = new CascadeSchemaError({
        typeName: 'User',
        field: 'email',
        value: 'invalid->',
        reason: 'Invalid reference format',
        hint: 'Use ->Type syntax',
      })

      expect(error.message).toContain('User.email')
      expect(error.message).toContain('Invalid reference format')
      expect(error.message).toContain('Hint:')
    })

    it('truncates long values', () => {
      const longValue = 'a'.repeat(100)
      const error = new CascadeSchemaError({
        value: longValue,
        reason: 'Too long',
      })

      expect(error.message).toContain('...')
      expect(error.message.length).toBeLessThan(longValue.length + 100)
    })

    it('works without optional fields', () => {
      const error = new CascadeSchemaError({
        reason: 'Something went wrong',
      })

      expect(error.message).toBe('Schema parsing error: Something went wrong')
    })
  })

  describe('CircularReferenceError', () => {
    it('shows cycle path', () => {
      const error = new CircularReferenceError(['A', 'B', 'C', 'A'])
      expect(error.message).toContain('A -> B -> C -> A')
    })

    it('provides helpful hint', () => {
      const error = new CircularReferenceError(['X', 'Y', 'X'])
      expect(error.hint).toContain('fuzzy operator')
    })
  })
})

// ============================================================================
// VALIDATION
// ============================================================================

describe('Schema Validation', () => {
  describe('validateReferences()', () => {
    it('returns empty array for valid schema', () => {
      const schema = {
        User: { name: 'string', profile: '->Profile' },
        Profile: { bio: 'string' },
      }

      const errors = defaultParser.validateReferences(schema)
      expect(errors).toHaveLength(0)
    })

    it('detects undefined type references', () => {
      const schema = {
        User: { name: 'string', role: '->Role' },
      }

      const errors = defaultParser.validateReferences(schema)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.reason).toContain('Role')
      expect(errors[0]!.reason).toContain('not defined')
    })

    it('allows primitive types', () => {
      const schema = {
        User: { name: 'string', age: 'number' },
      }

      const errors = defaultParser.validateReferences(schema)
      expect(errors).toHaveLength(0)
    })

    it('skips $ directives', () => {
      const schema = {
        $id: 'test-schema',
        User: { name: 'string' },
      } as Record<string, Record<string, unknown>>

      const errors = defaultParser.validateReferences(schema)
      expect(errors).toHaveLength(0)
    })
  })

  describe('detectCircularReferences()', () => {
    it('returns null for acyclic schema', () => {
      const schema = {
        A: { b: '->B' },
        B: { c: '->C' },
        C: { name: 'string' },
      }

      const error = defaultParser.detectCircularReferences(schema)
      expect(error).toBeNull()
    })

    it('detects direct circular reference', () => {
      const schema = {
        A: { b: '->B' },
        B: { a: '->A' },
      }

      const error = defaultParser.detectCircularReferences(schema)
      expect(error).toBeInstanceOf(CircularReferenceError)
      expect(error!.cyclePath).toContain('A')
      expect(error!.cyclePath).toContain('B')
    })

    it('detects self-reference', () => {
      const schema = {
        Node: { next: '->Node' },
      }

      const error = defaultParser.detectCircularReferences(schema)
      expect(error).toBeInstanceOf(CircularReferenceError)
    })

    it('ignores fuzzy operators in cycle detection', () => {
      const schema = {
        A: { b: '~>B' },
        B: { a: '~>A' },
      }

      // Fuzzy operators don't create hard dependencies
      const error = defaultParser.detectCircularReferences(schema)
      expect(error).toBeNull()
    })

    it('ignores optional references in cycle detection', () => {
      const schema = {
        A: { b: '->B?' },
        B: { a: '->A?' },
      }

      // Optional references don't create hard dependencies
      const error = defaultParser.detectCircularReferences(schema)
      expect(error).toBeNull()
    })
  })
})

// ============================================================================
// CACHING
// ============================================================================

describe('Schema Caching', () => {
  it('caches parsed references', () => {
    const parser = createSchemaParser({ enableCache: true })

    // Parse same reference twice
    const result1 = parser.parseReference('->User')
    const result2 = parser.parseReference('->User')

    // Results should be equal
    expect(result1).toEqual(result2)

    // Cache should have one entry
    const stats = parser.getCacheStats()
    expect(stats.size).toBe(1)
  })

  it('can be disabled', () => {
    const parser = createSchemaParser({ enableCache: false })

    parser.parseReference('->User')
    parser.parseReference('->User')

    const stats = parser.getCacheStats()
    expect(stats.size).toBe(0)
  })

  it('can be cleared', () => {
    const parser = createSchemaParser({ enableCache: true })

    parser.parseReference('->User')
    parser.parseReference('->Post')
    expect(parser.getCacheStats().size).toBe(2)

    parser.clearCache()
    expect(parser.getCacheStats().size).toBe(0)
  })
})

// ============================================================================
// PRIMITIVE TYPES
// ============================================================================

describe('Primitive Types', () => {
  it('recognizes standard primitives', () => {
    expect(defaultParser.isPrimitiveType('string')).toBe(true)
    expect(defaultParser.isPrimitiveType('number')).toBe(true)
    expect(defaultParser.isPrimitiveType('boolean')).toBe(true)
    expect(defaultParser.isPrimitiveType('date')).toBe(true)
  })

  it('recognizes extended primitives', () => {
    expect(defaultParser.isPrimitiveType('email')).toBe(true)
    expect(defaultParser.isPrimitiveType('url')).toBe(true)
    expect(defaultParser.isPrimitiveType('uuid')).toBe(true)
    expect(defaultParser.isPrimitiveType('json')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(defaultParser.isPrimitiveType('STRING')).toBe(true)
    expect(defaultParser.isPrimitiveType('Number')).toBe(true)
  })

  it('rejects non-primitive types', () => {
    expect(defaultParser.isPrimitiveType('User')).toBe(false)
    expect(defaultParser.isPrimitiveType('MyCustomType')).toBe(false)
  })

  it('exports PRIMITIVE_TYPES constant', () => {
    expect(PRIMITIVE_TYPES).toBeInstanceOf(Set)
    expect(PRIMITIVE_TYPES.has('string')).toBe(true)
  })
})

// ============================================================================
// TYPE NAME VALIDATION
// ============================================================================

describe('Type Name Validation', () => {
  it('validates PascalCase names', () => {
    expect(defaultParser.isValidTypeName('User')).toBe(true)
    expect(defaultParser.isValidTypeName('IdealCustomerProfile')).toBe(true)
    expect(defaultParser.isValidTypeName('AWS')).toBe(true)
  })

  it('rejects invalid names', () => {
    expect(defaultParser.isValidTypeName('user')).toBe(false)
    expect(defaultParser.isValidTypeName('my_type')).toBe(false)
    expect(defaultParser.isValidTypeName('123Type')).toBe(false)
    expect(defaultParser.isValidTypeName('')).toBe(false)
  })
})
