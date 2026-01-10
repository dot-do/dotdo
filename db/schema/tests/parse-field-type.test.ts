import { describe, it, expect } from 'vitest'

/**
 * Field Type Parsing Tests
 *
 * These tests verify the parseFieldType function that converts various field
 * value formats into normalized ParsedField objects for the cascade schema.
 *
 * This is RED phase TDD - tests should FAIL until implementation exists.
 *
 * Supported field formats:
 * - String prompts: 'What is the concept?'
 * - Array prompts: ['List the problems']
 * - Nested objects: { wants: 'What?', fears: 'Why?' }
 * - Computed fields: (e) => e.first + e.last
 * - Boolean defaults: true/false
 * - Number defaults: 0, 42, 3.14
 */

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface ParsedField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'computed'
  description?: string
  default?: unknown
  items?: string | ParsedField
  properties?: Record<string, ParsedField>
  source?: string
}

// Import from non-existent module - will fail until implementation
import { parseFieldType } from '../parse-field-type'

// ============================================================================
// String Field Tests
// ============================================================================

describe('parseFieldType', () => {
  describe('String Fields', () => {
    it('parses plain string prompt into string field', () => {
      const result = parseFieldType('What is the concept?')

      expect(result).toEqual({
        type: 'string',
        description: 'What is the concept?',
      })
    })

    it('parses empty string prompt', () => {
      const result = parseFieldType('')

      expect(result).toEqual({
        type: 'string',
        description: '',
      })
    })

    it('parses multi-line string prompt', () => {
      const prompt = `Describe the product.
Include features and benefits.`
      const result = parseFieldType(prompt)

      expect(result).toEqual({
        type: 'string',
        description: prompt,
      })
    })

    it('trims whitespace from string prompts', () => {
      const result = parseFieldType('  What is the idea?  ')

      expect(result).toEqual({
        type: 'string',
        description: 'What is the idea?',
      })
    })
  })

  // ============================================================================
  // Array Field Tests
  // ============================================================================

  describe('Array Fields', () => {
    it('parses array with string prompt into array field', () => {
      const result = parseFieldType(['List the problems'])

      expect(result).toEqual({
        type: 'array',
        items: 'string',
        description: 'List the problems',
      })
    })

    it('parses empty array into generic array field', () => {
      const result = parseFieldType([])

      expect(result).toEqual({
        type: 'array',
        items: 'string',
      })
    })

    it('parses array with multiple prompts', () => {
      const result = parseFieldType(['What are the goals?', 'Be specific'])

      expect(result).toEqual({
        type: 'array',
        items: 'string',
        description: 'What are the goals? Be specific',
      })
    })

    it('parses array with nested object schema', () => {
      const result = parseFieldType([{ name: 'Name?', role: 'Role?' }])

      expect(result).toEqual({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name?' },
            role: { type: 'string', description: 'Role?' },
          },
        },
      })
    })
  })

  // ============================================================================
  // Nested Object Field Tests
  // ============================================================================

  describe('Nested Object Fields', () => {
    it('parses simple object with string prompts', () => {
      const result = parseFieldType({
        wants: 'What does the customer want?',
        fears: 'What are their fears?',
      })

      expect(result).toEqual({
        type: 'object',
        properties: {
          wants: { type: 'string', description: 'What does the customer want?' },
          fears: { type: 'string', description: 'What are their fears?' },
        },
      })
    })

    it('parses nested object with mixed field types', () => {
      const result = parseFieldType({
        name: 'What is the name?',
        age: 0,
        active: true,
        tags: ['List tags'],
      })

      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What is the name?' },
          age: { type: 'number', default: 0 },
          active: { type: 'boolean', default: true },
          tags: { type: 'array', items: 'string', description: 'List tags' },
        },
      })
    })

    it('parses deeply nested objects', () => {
      const result = parseFieldType({
        user: {
          profile: {
            bio: 'Write a bio',
          },
        },
      })

      expect(result).toEqual({
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  bio: { type: 'string', description: 'Write a bio' },
                },
              },
            },
          },
        },
      })
    })

    it('parses empty object', () => {
      const result = parseFieldType({})

      expect(result).toEqual({
        type: 'object',
        properties: {},
      })
    })
  })

  // ============================================================================
  // Computed Field Tests
  // ============================================================================

  describe('Computed Fields', () => {
    it('parses arrow function into computed field', () => {
      const fn = (e: { first: string; last: string }) => e.first + ' ' + e.last
      const result = parseFieldType(fn)

      expect(result.type).toBe('computed')
      expect(result.source).toBeDefined()
      expect(result.source).toContain('first')
      expect(result.source).toContain('last')
    })

    it('parses simple property accessor', () => {
      const fn = (e: { name: string }) => e.name.toUpperCase()
      const result = parseFieldType(fn)

      expect(result.type).toBe('computed')
      expect(result.source).toContain('toUpperCase')
    })

    it('parses function expression', () => {
      const fn = function (e: { count: number }) {
        return e.count * 2
      }
      const result = parseFieldType(fn)

      expect(result.type).toBe('computed')
      expect(result.source).toContain('count')
    })

    it('parses async function', () => {
      const fn = async (e: { id: string }) => {
        return `processed-${e.id}`
      }
      const result = parseFieldType(fn)

      expect(result.type).toBe('computed')
      expect(result.source).toContain('id')
    })

    it('preserves function source code', () => {
      const fn = (e: { a: number; b: number }) => e.a + e.b
      const result = parseFieldType(fn)

      expect(result.type).toBe('computed')
      // Source should be serializable/inspectable
      expect(typeof result.source).toBe('string')
    })
  })

  // ============================================================================
  // Boolean/Number Default Tests
  // ============================================================================

  describe('Boolean Fields', () => {
    it('parses true as boolean field with default true', () => {
      const result = parseFieldType(true)

      expect(result).toEqual({
        type: 'boolean',
        default: true,
      })
    })

    it('parses false as boolean field with default false', () => {
      const result = parseFieldType(false)

      expect(result).toEqual({
        type: 'boolean',
        default: false,
      })
    })
  })

  describe('Number Fields', () => {
    it('parses 0 as number field with default 0', () => {
      const result = parseFieldType(0)

      expect(result).toEqual({
        type: 'number',
        default: 0,
      })
    })

    it('parses positive integer as number field', () => {
      const result = parseFieldType(42)

      expect(result).toEqual({
        type: 'number',
        default: 42,
      })
    })

    it('parses negative integer as number field', () => {
      const result = parseFieldType(-10)

      expect(result).toEqual({
        type: 'number',
        default: -10,
      })
    })

    it('parses float as number field', () => {
      const result = parseFieldType(3.14159)

      expect(result).toEqual({
        type: 'number',
        default: 3.14159,
      })
    })

    it('parses Infinity as number field', () => {
      const result = parseFieldType(Infinity)

      expect(result).toEqual({
        type: 'number',
        default: Infinity,
      })
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles null gracefully', () => {
      const result = parseFieldType(null as unknown)

      expect(result).toEqual({
        type: 'string',
        description: '',
      })
    })

    it('handles undefined gracefully', () => {
      const result = parseFieldType(undefined as unknown)

      expect(result).toEqual({
        type: 'string',
        description: '',
      })
    })

    it('handles symbol by converting to string description', () => {
      const sym = Symbol('test')
      const result = parseFieldType(sym as unknown)

      expect(result.type).toBe('string')
    })

    it('handles Date objects as string fields', () => {
      const date = new Date('2024-01-01')
      const result = parseFieldType(date as unknown)

      expect(result.type).toBe('string')
    })
  })

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe('Type Safety', () => {
    it('returns ParsedField type', () => {
      const result: ParsedField = parseFieldType('test')
      expect(result.type).toBeDefined()
    })

    it('type property is one of the allowed types', () => {
      const allowedTypes = ['string', 'number', 'boolean', 'array', 'object', 'computed']

      expect(allowedTypes).toContain(parseFieldType('test').type)
      expect(allowedTypes).toContain(parseFieldType(42).type)
      expect(allowedTypes).toContain(parseFieldType(true).type)
      expect(allowedTypes).toContain(parseFieldType([]).type)
      expect(allowedTypes).toContain(parseFieldType({}).type)
      expect(allowedTypes).toContain(parseFieldType(() => {}).type)
    })
  })
})
