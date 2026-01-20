/**
 * Tests for IceType schema DSL
 */

import { describe, it, expect } from 'vitest'
import {
  IceType,
  DB,
  IceTypeParser,
  parseField,
  parseEntity,
  parseDirectives,
  validateEntitySchema,
  inferType,
  iceTypeToSchema,
} from '../icetype'

describe('IceType Schema DSL', () => {
  describe('parseField', () => {
    it('should parse basic types', () => {
      const stringField = parseField('name', 'string')
      expect(stringField.type).toBe('string')
      expect(stringField.isRequired).toBe(false)
      expect(stringField.isArray).toBe(false)

      const intField = parseField('age', 'int')
      expect(intField.type).toBe('int')
    })

    it('should parse required fields with !', () => {
      const field = parseField('name', 'string!')
      expect(field.type).toBe('string')
      expect(field.isRequired).toBe(true)
    })

    it('should parse optional fields with ?', () => {
      const field = parseField('nickname', 'string?')
      expect(field.type).toBe('string')
      expect(field.isOptional).toBe(true)
    })

    it('should parse unique fields with #', () => {
      const field = parseField('email', 'string#')
      expect(field.type).toBe('string')
      expect(field.isUnique).toBe(true)
      expect(field.isIndexed).toBe(true)
    })

    it('should parse array types', () => {
      const field = parseField('tags', 'string[]')
      expect(field.type).toBe('string')
      expect(field.isArray).toBe(true)
    })

    it('should parse parametric types', () => {
      const decimal = parseField('price', 'decimal(10,2)')
      expect(decimal.type).toBe('decimal')
      expect(decimal.precision).toBe(10)
      expect(decimal.scale).toBe(2)

      const varchar = parseField('code', 'varchar(50)')
      expect(varchar.type).toBe('varchar')
      expect(varchar.length).toBe(50)
    })

    it('should parse vector types', () => {
      const vector = parseField('embedding', 'vector[1536]')
      expect(vector.type).toBe('vector')
      expect(vector.dimensions).toBe(1536)
    })

    it('should parse combined modifiers', () => {
      const field = parseField('email', 'string!#')
      expect(field.type).toBe('string')
      expect(field.isRequired).toBe(true)
      expect(field.isUnique).toBe(true)
    })

    it('should parse index directive', () => {
      const field = parseField('email', 'string! #unique')
      expect(field.type).toBe('string')
      expect(field.isRequired).toBe(true)
      expect(field.isUnique).toBe(true)
      expect(field.isIndexed).toBe(true)
    })

    it('should parse default values', () => {
      const field = parseField('status', "string = 'active'")
      expect(field.type).toBe('string')
      expect(field.defaultValue).toBe('active')

      const numField = parseField('count', 'int = 0')
      expect(numField.defaultValue).toBe(0)

      const boolField = parseField('active', 'bool = true')
      expect(boolField.defaultValue).toBe(true)
    })

    it('should parse function default values', () => {
      const field = parseField('id', 'uuid = uuid()')
      expect(field.defaultValue).toEqual({ $function: 'uuid' })

      const timestamp = parseField('createdAt', 'timestamp = now()')
      expect(timestamp.defaultValue).toEqual({ $function: 'now' })
    })

    it('should parse forward relations', () => {
      const field = parseField('customer', '-> Customer')
      expect(field.relation).toBeDefined()
      expect(field.relation!.operator).toBe('->')
      expect(field.relation!.targetType).toBe('Customer')
      expect(field.relation!.isArray).toBe(false)
    })

    it('should parse array relations', () => {
      const field = parseField('orders', '-> Order[]')
      expect(field.relation).toBeDefined()
      expect(field.relation!.operator).toBe('->')
      expect(field.relation!.targetType).toBe('Order')
      expect(field.relation!.isArray).toBe(true)
    })

    it('should parse backward relations with inverse', () => {
      const field = parseField('customer', '<- Customer.orders')
      expect(field.relation).toBeDefined()
      expect(field.relation!.operator).toBe('<-')
      expect(field.relation!.targetType).toBe('Customer')
      expect(field.relation!.inverse).toBe('orders')
    })

    it('should parse fuzzy relations', () => {
      const field = parseField('similar', '~> Product[]')
      expect(field.relation).toBeDefined()
      expect(field.relation!.operator).toBe('~>')
      expect(field.relation!.targetType).toBe('Product')
    })
  })

  describe('parseDirectives', () => {
    it('should parse $type directive', () => {
      const directives = parseDirectives({ $type: 'Customer' })
      expect(directives.$type).toBe('Customer')
    })

    it('should parse $fts directive', () => {
      const directives = parseDirectives({ $fts: ['name', 'description'] })
      expect(directives.$fts).toEqual(['name', 'description'])
    })

    it('should parse $vector directive', () => {
      const directives = parseDirectives({
        $vector: {
          embedding: 1536,
          titleEmbedding: { dimensions: 768, metric: 'cosine' }
        }
      })
      expect(directives.$vector).toHaveLength(2)
      expect(directives.$vector![0]).toEqual({ field: 'embedding', dimensions: 1536 })
      expect(directives.$vector![1]).toMatchObject({
        field: 'titleEmbedding',
        dimensions: 768,
        metric: 'cosine'
      })
    })

    it('should parse $partitionBy directive', () => {
      const directives = parseDirectives({ $partitionBy: ['tenantId'] })
      expect(directives.$partitionBy).toEqual(['tenantId'])
    })

    it('should parse $index directive', () => {
      const directives = parseDirectives({
        $index: [
          ['name', 'email'],
          { fields: ['createdAt'], unique: false }
        ]
      })
      expect(directives.$index).toHaveLength(2)
      expect(directives.$index![0]).toEqual({ fields: ['name', 'email'], unique: false })
      expect(directives.$index![1]).toEqual({ fields: ['createdAt'], unique: false })
    })
  })

  describe('parseEntity', () => {
    it('should parse a complete entity definition', () => {
      const entity = parseEntity('Customer', {
        $type: 'Customer',
        name: 'string!',
        email: 'string! #unique',
        age: 'int?',
        orders: '-> Order[]',
        $fts: ['name', 'email'],
      })

      expect(entity.name).toBe('Customer')
      expect(entity.fields.size).toBe(4)
      expect(entity.relations.size).toBe(1)
      expect(entity.directives.$fts).toEqual(['name', 'email'])

      const nameField = entity.fields.get('name')!
      expect(nameField.isRequired).toBe(true)

      const emailField = entity.fields.get('email')!
      expect(emailField.isUnique).toBe(true)

      const ordersField = entity.fields.get('orders')!
      expect(ordersField.relation).toBeDefined()
      expect(ordersField.relation!.isArray).toBe(true)
    })
  })

  describe('IceType factory', () => {
    it('should create a database schema', () => {
      const schema = IceType({
        User: {
          $type: 'User',
          name: 'string!',
          email: 'string! #unique',
          posts: '-> Post[]',
        },
        Post: {
          $type: 'Post',
          title: 'string!',
          content: 'text',
          author: '<- User.posts',
        }
      })

      expect(schema.entities.size).toBe(2)
      expect(schema.entities.has('User')).toBe(true)
      expect(schema.entities.has('Post')).toBe(true)

      const user = schema.entities.get('User')!
      expect(user.fields.has('posts')).toBe(true)
      expect(user.relations.has('posts')).toBe(true)

      const post = schema.entities.get('Post')!
      expect(post.relations.get('author')!.inverse).toBe('posts')
    })

    it('should support DB alias', () => {
      const schema = DB({
        Thing: {
          $type: 'Thing',
          name: 'string',
        }
      })

      expect(schema.entities.has('Thing')).toBe(true)
    })
  })

  describe('validateEntitySchema', () => {
    it('should validate valid schemas', () => {
      const entity = parseEntity('Valid', {
        $type: 'Valid',
        name: 'string!',
        count: 'int',
      })

      const result = validateEntitySchema(entity)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect unknown types', () => {
      const entity = parseEntity('Invalid', {
        $type: 'Invalid',
        field: 'unknowntype',
      })

      const result = validateEntitySchema(entity)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Unknown type'))).toBe(true)
    })

    it('should detect invalid $fts references', () => {
      const entity = parseEntity('Invalid', {
        $type: 'Invalid',
        name: 'string',
        $fts: ['name', 'nonexistent'],
      })

      const result = validateEntitySchema(entity)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field.includes('$fts'))).toBe(true)
    })

    it('should detect invalid $vector dimensions', () => {
      const entity = parseEntity('Invalid', {
        $type: 'Invalid',
        embedding: 'json',
        $vector: { embedding: 0 },
      })

      const result = validateEntitySchema(entity)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('dimensions'))).toBe(true)
    })
  })

  describe('inferType', () => {
    it('should infer string types', () => {
      expect(inferType('hello')).toBe('string')
      expect(inferType('550e8400-e29b-41d4-a716-446655440000')).toBe('uuid')
      expect(inferType('2024-01-15T10:30:00Z')).toBe('timestamp')
      expect(inferType('2024-01-15')).toBe('date')
    })

    it('should infer number types', () => {
      expect(inferType(42)).toBe('int')
      expect(inferType(3.14)).toBe('float')
      expect(inferType(9007199254740993)).toBe('bigint') // Beyond safe integer
    })

    it('should infer other types', () => {
      expect(inferType(true)).toBe('bool')
      expect(inferType(null)).toBe('json?')
      expect(inferType(undefined)).toBe('json?')
      expect(inferType({ key: 'value' })).toBe('json')
      expect(inferType([1, 2, 3])).toBe('int[]')
      expect(inferType([])).toBe('json[]')
    })
  })

  describe('iceTypeToSchema', () => {
    it('should convert IceType schema to validation Schema', () => {
      const entity = parseEntity('Customer', {
        $type: 'Customer',
        name: 'string!',
        email: 'string?',
        age: 'int?',
      })

      const schema = iceTypeToSchema(entity)

      // Valid data
      const valid = schema.validate({
        name: 'John',
        email: 'john@example.com',
        age: 30,
      })
      expect(valid.valid).toBe(true)

      // Missing required field
      const invalid = schema.validate({
        email: 'john@example.com',
      })
      expect(invalid.valid).toBe(false)
      expect(invalid.errors.some(e => e.field === 'name')).toBe(true)

      // Wrong type
      const wrongType = schema.validate({
        name: 'John',
        age: 'thirty', // Should be number
      })
      expect(wrongType.valid).toBe(false)
    })

    it('should validate vector fields', () => {
      const entity = parseEntity('Document', {
        $type: 'Document',
        embedding: 'vector[3]',
      })

      const schema = iceTypeToSchema(entity)

      // Valid vector
      const valid = schema.validate({
        embedding: [0.1, 0.2, 0.3],
      })
      expect(valid.valid).toBe(true)

      // Wrong dimensions
      const wrongDimensions = schema.validate({
        embedding: [0.1, 0.2],
      })
      expect(wrongDimensions.valid).toBe(false)

      // Not an array
      const notArray = schema.validate({
        embedding: 'not an array',
      })
      expect(notArray.valid).toBe(false)
    })
  })
})
