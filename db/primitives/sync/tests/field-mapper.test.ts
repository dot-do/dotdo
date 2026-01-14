/**
 * FieldMapper Tests
 *
 * TDD test suite for field mapping and transformation in sync scenarios.
 *
 * The FieldMapper handles transforming records from source schemas to destination
 * schemas, applying field renames, built-in transforms, custom functions, defaults,
 * and validation.
 *
 * Test Coverage:
 * - [x] FieldMapper renames fields according to mapping
 * - [x] FieldMapper applies built-in transforms
 * - [x] FieldMapper supports custom transform functions
 * - [x] FieldMapper uses default values for missing fields
 * - [x] FieldMapper validates required fields
 * - [x] FieldMapper handles nested field paths
 *
 * @module db/primitives/sync/tests/field-mapper.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FieldMapper,
  createFieldMapper,
  type FieldMapping,
  type TransformFunction,
  type TransformPipeline,
  type FieldMapperOptions,
  type MappingValidationError,
} from '../field-mapper'

// =============================================================================
// TEST HELPERS
// =============================================================================

type Record = { [key: string]: unknown }

function createRecord(data: Record): Record {
  return { ...data }
}

// =============================================================================
// FIELD MAPPER TESTS
// =============================================================================

describe('FieldMapper', () => {
  let mapper: FieldMapper

  beforeEach(() => {
    mapper = new FieldMapper()
  })

  describe('basic field renaming', () => {
    it('renames fields according to mapping', () => {
      const record = createRecord({
        first_name: 'Alice',
        last_name: 'Smith',
        email_address: 'alice@example.com',
      })

      const mappings: FieldMapping[] = [
        { source: 'first_name', destination: 'firstName' },
        { source: 'last_name', destination: 'lastName' },
        { source: 'email_address', destination: 'email' },
      ]

      const result = mapper.map(record, mappings)

      expect(result).toEqual({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
      })
    })

    it('handles identity mapping (same source and destination)', () => {
      const record = createRecord({
        id: '123',
        name: 'Alice',
      })

      const mappings: FieldMapping[] = [
        { source: 'id', destination: 'id' },
        { source: 'name', destination: 'name' },
      ]

      const result = mapper.map(record, mappings)

      expect(result).toEqual({
        id: '123',
        name: 'Alice',
      })
    })

    it('only includes mapped fields in output', () => {
      const record = createRecord({
        id: '123',
        name: 'Alice',
        secret: 'should-not-appear',
      })

      const mappings: FieldMapping[] = [
        { source: 'id', destination: 'id' },
        { source: 'name', destination: 'name' },
      ]

      const result = mapper.map(record, mappings)

      expect(result).toEqual({
        id: '123',
        name: 'Alice',
      })
      expect(result).not.toHaveProperty('secret')
    })

    it('handles empty mappings', () => {
      const record = createRecord({
        name: 'Alice',
      })

      const result = mapper.map(record, [])

      expect(result).toEqual({})
    })

    it('handles empty record', () => {
      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'fullName' },
      ]

      const result = mapper.map({}, mappings)

      expect(result).toEqual({})
    })
  })

  describe('built-in transforms', () => {
    it('applies uppercase transform', () => {
      const record = createRecord({
        name: 'alice smith',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: 'uppercase' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('ALICE SMITH')
    })

    it('applies lowercase transform', () => {
      const record = createRecord({
        name: 'ALICE SMITH',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: 'lowercase' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('alice smith')
    })

    it('applies trim transform', () => {
      const record = createRecord({
        name: '  Alice Smith  ',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: 'trim' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('Alice Smith')
    })

    it('applies toDate transform for ISO string', () => {
      const record = createRecord({
        created: '2026-01-13T10:00:00Z',
      })

      const mappings: FieldMapping[] = [
        { source: 'created', destination: 'createdAt', transform: 'toDate' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.createdAt).toBeInstanceOf(Date)
      expect((result.createdAt as Date).toISOString()).toBe('2026-01-13T10:00:00.000Z')
    })

    it('applies toDate transform for timestamp number', () => {
      const timestamp = 1736762400000 // 2026-01-13T10:00:00Z
      const record = createRecord({
        created: timestamp,
      })

      const mappings: FieldMapping[] = [
        { source: 'created', destination: 'createdAt', transform: 'toDate' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.createdAt).toBeInstanceOf(Date)
      expect((result.createdAt as Date).getTime()).toBe(timestamp)
    })

    it('applies toNumber transform for string number', () => {
      const record = createRecord({
        count: '42',
        price: '19.99',
      })

      const mappings: FieldMapping[] = [
        { source: 'count', destination: 'count', transform: 'toNumber' },
        { source: 'price', destination: 'price', transform: 'toNumber' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.count).toBe(42)
      expect(result.price).toBe(19.99)
    })

    it('handles null values with transforms gracefully', () => {
      const record = createRecord({
        name: null,
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: 'uppercase' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBeNull()
    })

    it('handles undefined values with transforms gracefully', () => {
      const record = createRecord({
        name: undefined,
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: 'uppercase' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBeUndefined()
    })
  })

  describe('custom transform functions', () => {
    it('supports custom transform functions', () => {
      const record = createRecord({
        firstName: 'Alice',
        lastName: 'Smith',
      })

      const fullNameTransform: TransformFunction = (value, rec) => {
        return `${rec.firstName} ${rec.lastName}`
      }

      const mappings: FieldMapping[] = [
        { source: 'firstName', destination: 'fullName', transform: fullNameTransform },
      ]

      const result = mapper.map(record, mappings)

      expect(result.fullName).toBe('Alice Smith')
    })

    it('passes current record to custom transform', () => {
      const record = createRecord({
        amount: 100,
        currency: 'USD',
      })

      const formatCurrency: TransformFunction = (value, rec) => {
        return `${rec.currency} ${value}`
      }

      const mappings: FieldMapping[] = [
        { source: 'amount', destination: 'formattedAmount', transform: formatCurrency },
      ]

      const result = mapper.map(record, mappings)

      expect(result.formattedAmount).toBe('USD 100')
    })

    it('handles custom transform returning objects', () => {
      const record = createRecord({
        fullName: 'Alice Smith',
      })

      const splitName: TransformFunction = (value) => {
        const parts = (value as string).split(' ')
        return { first: parts[0], last: parts[1] }
      }

      const mappings: FieldMapping[] = [
        { source: 'fullName', destination: 'name', transform: splitName },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toEqual({ first: 'Alice', last: 'Smith' })
    })

    it('handles custom transform returning arrays', () => {
      const record = createRecord({
        tags: 'a,b,c',
      })

      const splitTags: TransformFunction = (value) => {
        return (value as string).split(',')
      }

      const mappings: FieldMapping[] = [
        { source: 'tags', destination: 'tags', transform: splitTags },
      ]

      const result = mapper.map(record, mappings)

      expect(result.tags).toEqual(['a', 'b', 'c'])
    })
  })

  describe('transform pipelines', () => {
    it('applies transform pipeline in order', () => {
      const record = createRecord({
        name: '  ALICE SMITH  ',
      })

      const pipeline: TransformPipeline = ['trim', 'lowercase']

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: pipeline },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('alice smith')
    })

    it('supports mixed pipeline with built-in and custom transforms', () => {
      const record = createRecord({
        email: '  ALICE@EXAMPLE.COM  ',
      })

      const addDomain: TransformFunction = (value) => {
        const email = value as string
        if (!email.includes('@')) {
          return `${email}@default.com`
        }
        return email
      }

      const pipeline: TransformPipeline = ['trim', 'lowercase', addDomain]

      const mappings: FieldMapping[] = [
        { source: 'email', destination: 'email', transform: pipeline },
      ]

      const result = mapper.map(record, mappings)

      expect(result.email).toBe('alice@example.com')
    })

    it('handles empty pipeline', () => {
      const record = createRecord({
        name: 'Alice',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', transform: [] },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('Alice')
    })
  })

  describe('default values', () => {
    it('uses default value for missing fields', () => {
      const record = createRecord({
        name: 'Alice',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name' },
        { source: 'role', destination: 'role', default: 'user' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('Alice')
      expect(result.role).toBe('user')
    })

    it('uses default value for null fields', () => {
      const record = createRecord({
        name: null,
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', default: 'Unknown' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('Unknown')
    })

    it('uses default value for undefined fields', () => {
      const record = createRecord({
        name: undefined,
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', default: 'Unknown' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('Unknown')
    })

    it('does not use default for empty string', () => {
      const record = createRecord({
        name: '',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', default: 'Unknown' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('')
    })

    it('does not use default for zero', () => {
      const record = createRecord({
        count: 0,
      })

      const mappings: FieldMapping[] = [
        { source: 'count', destination: 'count', default: 10 },
      ]

      const result = mapper.map(record, mappings)

      expect(result.count).toBe(0)
    })

    it('does not use default for false', () => {
      const record = createRecord({
        active: false,
      })

      const mappings: FieldMapping[] = [
        { source: 'active', destination: 'active', default: true },
      ]

      const result = mapper.map(record, mappings)

      expect(result.active).toBe(false)
    })

    it('supports default value functions', () => {
      const record = createRecord({})

      const mappings: FieldMapping[] = [
        { source: 'createdAt', destination: 'createdAt', default: () => new Date('2026-01-13') },
      ]

      const result = mapper.map(record, mappings)

      expect(result.createdAt).toBeInstanceOf(Date)
      expect((result.createdAt as Date).toISOString()).toContain('2026-01-13')
    })

    it('applies transform after using default value', () => {
      const record = createRecord({})

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', default: 'unknown', transform: 'uppercase' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('UNKNOWN')
    })
  })

  describe('required field validation', () => {
    it('validates required fields', () => {
      const record = createRecord({
        name: 'Alice',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', required: true },
        { source: 'email', destination: 'email', required: true },
      ]

      expect(() => mapper.map(record, mappings)).toThrow()
    })

    it('provides detailed error for missing required field', () => {
      const record = createRecord({
        name: 'Alice',
      })

      const mappings: FieldMapping[] = [
        { source: 'email', destination: 'email', required: true },
      ]

      try {
        mapper.map(record, mappings)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('email')
        expect((error as Error).message.toLowerCase()).toContain('required')
      }
    })

    it('considers null as missing for required fields', () => {
      const record = createRecord({
        email: null,
      })

      const mappings: FieldMapping[] = [
        { source: 'email', destination: 'email', required: true },
      ]

      expect(() => mapper.map(record, mappings)).toThrow()
    })

    it('considers undefined as missing for required fields', () => {
      const record = createRecord({
        email: undefined,
      })

      const mappings: FieldMapping[] = [
        { source: 'email', destination: 'email', required: true },
      ]

      expect(() => mapper.map(record, mappings)).toThrow()
    })

    it('allows empty string for required fields', () => {
      const record = createRecord({
        email: '',
      })

      const mappings: FieldMapping[] = [
        { source: 'email', destination: 'email', required: true },
      ]

      const result = mapper.map(record, mappings)

      expect(result.email).toBe('')
    })

    it('allows zero for required fields', () => {
      const record = createRecord({
        count: 0,
      })

      const mappings: FieldMapping[] = [
        { source: 'count', destination: 'count', required: true },
      ]

      const result = mapper.map(record, mappings)

      expect(result.count).toBe(0)
    })

    it('allows false for required fields', () => {
      const record = createRecord({
        active: false,
      })

      const mappings: FieldMapping[] = [
        { source: 'active', destination: 'active', required: true },
      ]

      const result = mapper.map(record, mappings)

      expect(result.active).toBe(false)
    })

    it('uses default value before checking required', () => {
      const record = createRecord({})

      const mappings: FieldMapping[] = [
        { source: 'role', destination: 'role', required: true, default: 'user' },
      ]

      // Should NOT throw because default provides the value
      const result = mapper.map(record, mappings)

      expect(result.role).toBe('user')
    })
  })

  describe('nested field paths', () => {
    it('handles nested source field paths', () => {
      const record = createRecord({
        user: {
          profile: {
            name: 'Alice',
          },
        },
      })

      const mappings: FieldMapping[] = [
        { source: 'user.profile.name', destination: 'userName' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.userName).toBe('Alice')
    })

    it('handles nested destination field paths', () => {
      const record = createRecord({
        firstName: 'Alice',
        lastName: 'Smith',
      })

      const mappings: FieldMapping[] = [
        { source: 'firstName', destination: 'user.name.first' },
        { source: 'lastName', destination: 'user.name.last' },
      ]

      const result = mapper.map(record, mappings)

      expect(result).toEqual({
        user: {
          name: {
            first: 'Alice',
            last: 'Smith',
          },
        },
      })
    })

    it('handles both nested source and destination paths', () => {
      const record = createRecord({
        data: {
          person: {
            firstName: 'Alice',
          },
        },
      })

      const mappings: FieldMapping[] = [
        { source: 'data.person.firstName', destination: 'user.profile.name' },
      ]

      const result = mapper.map(record, mappings)

      expect(result).toEqual({
        user: {
          profile: {
            name: 'Alice',
          },
        },
      })
    })

    it('returns undefined for missing nested source path', () => {
      const record = createRecord({
        user: {},
      })

      const mappings: FieldMapping[] = [
        { source: 'user.profile.name', destination: 'name' },
      ]

      const result = mapper.map(record, mappings)

      expect(result).toEqual({})
    })

    it('uses default for missing nested source path', () => {
      const record = createRecord({
        user: {},
      })

      const mappings: FieldMapping[] = [
        { source: 'user.profile.name', destination: 'name', default: 'Unknown' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('Unknown')
    })

    it('handles array index in nested path', () => {
      const record = createRecord({
        users: [
          { name: 'Alice' },
          { name: 'Bob' },
        ],
      })

      const mappings: FieldMapping[] = [
        { source: 'users.0.name', destination: 'firstUser' },
        { source: 'users.1.name', destination: 'secondUser' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.firstUser).toBe('Alice')
      expect(result.secondUser).toBe('Bob')
    })

    it('applies transforms to nested field values', () => {
      const record = createRecord({
        user: {
          name: 'alice smith',
        },
      })

      const mappings: FieldMapping[] = [
        { source: 'user.name', destination: 'name', transform: 'uppercase' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.name).toBe('ALICE SMITH')
    })
  })

  describe('mapMany', () => {
    it('maps multiple records', () => {
      const records = [
        createRecord({ first_name: 'Alice', age: '30' }),
        createRecord({ first_name: 'Bob', age: '25' }),
      ]

      const mappings: FieldMapping[] = [
        { source: 'first_name', destination: 'name' },
        { source: 'age', destination: 'age', transform: 'toNumber' },
      ]

      const results = mapper.mapMany(records, mappings)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({ name: 'Alice', age: 30 })
      expect(results[1]).toEqual({ name: 'Bob', age: 25 })
    })

    it('handles empty array', () => {
      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name' },
      ]

      const results = mapper.mapMany([], mappings)

      expect(results).toEqual([])
    })
  })

  describe('validation mode', () => {
    it('validates mappings without throwing in validation mode', () => {
      mapper = new FieldMapper({ validationMode: true })

      const record = createRecord({
        name: 'Alice',
      })

      const mappings: FieldMapping[] = [
        { source: 'email', destination: 'email', required: true },
      ]

      const result = mapper.validate(record, mappings)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe('email')
      expect(result.errors[0].type).toBe('required')
    })

    it('returns valid result when all mappings succeed', () => {
      mapper = new FieldMapper({ validationMode: true })

      const record = createRecord({
        name: 'Alice',
        email: 'alice@example.com',
      })

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', required: true },
        { source: 'email', destination: 'email', required: true },
      ]

      const result = mapper.validate(record, mappings)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('collects multiple validation errors', () => {
      mapper = new FieldMapper({ validationMode: true })

      const record = createRecord({})

      const mappings: FieldMapping[] = [
        { source: 'name', destination: 'name', required: true },
        { source: 'email', destination: 'email', required: true },
        { source: 'age', destination: 'age', required: true },
      ]

      const result = mapper.validate(record, mappings)

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
    })
  })

  describe('error handling', () => {
    it('handles transform errors gracefully', () => {
      const record = createRecord({
        date: 'not-a-date',
      })

      const mappings: FieldMapping[] = [
        { source: 'date', destination: 'date', transform: 'toDate' },
      ]

      // Should not throw, but return invalid date or original value
      const result = mapper.map(record, mappings)

      // Implementation can either return invalid date or original value
      expect(result).toBeDefined()
    })

    it('handles toNumber with non-numeric string', () => {
      const record = createRecord({
        count: 'abc',
      })

      const mappings: FieldMapping[] = [
        { source: 'count', destination: 'count', transform: 'toNumber' },
      ]

      const result = mapper.map(record, mappings)

      expect(result.count).toBeNaN()
    })

    it('handles custom transform throwing error', () => {
      const record = createRecord({
        value: 'test',
      })

      const throwingTransform: TransformFunction = () => {
        throw new Error('Transform failed')
      }

      const mappings: FieldMapping[] = [
        { source: 'value', destination: 'value', transform: throwingTransform },
      ]

      expect(() => mapper.map(record, mappings)).toThrow('Transform failed')
    })
  })

  describe('factory function', () => {
    it('creates FieldMapper with options', () => {
      const customMapper = createFieldMapper({ validationMode: true })

      expect(customMapper).toBeInstanceOf(FieldMapper)
    })

    it('creates FieldMapper with default options', () => {
      const customMapper = createFieldMapper()

      expect(customMapper).toBeInstanceOf(FieldMapper)
    })
  })
})
