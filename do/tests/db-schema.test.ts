/**
 * DB Schema Tests (do-lekf.8)
 *
 * Tests for $.DB() method that defines entire database schema at once.
 * Uses ai-database style schema definitions with IceType modifiers.
 *
 * @module do/tests/db-schema.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createContext, type WorkflowContext } from '../workflow/context'
import { createThingsStore, type ThingsStore } from '../../db'
import {
  parseSchema,
  parseFieldDefinition,
  parseRelation,
  isPromptField,
  isRelationField,
} from '../schema/parser'

// =============================================================================
// TEST HELPER - Create mock DurableObjectState
// =============================================================================

function createMockState(): DurableObjectState {
  return {
    id: { toString: () => 'test-do-id' },
    waitUntil: () => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DurableObjectState
}

// =============================================================================
// SCHEMA PARSER TESTS
// =============================================================================

describe('Schema Parser', () => {
  describe('parseFieldDefinition', () => {
    it('should parse required string field', () => {
      const result = parseFieldDefinition('name', 'string!')
      expect(result.type).toBe('string')
      expect(result.required).toBe(true)
      expect(result.optional).toBe(false)
    })

    it('should parse optional string field', () => {
      const result = parseFieldDefinition('description', 'string?')
      expect(result.type).toBe('string')
      expect(result.required).toBe(false)
      expect(result.optional).toBe(true)
    })

    it('should parse indexed field', () => {
      const result = parseFieldDefinition('sku', 'string#')
      expect(result.type).toBe('string')
      expect(result.indexed).toBe(true)
      expect(result.unique).toBe(true)
    })

    it('should parse required indexed field', () => {
      const result = parseFieldDefinition('email', 'string!#')
      expect(result.type).toBe('string')
      expect(result.required).toBe(true)
      expect(result.indexed).toBe(true)
    })

    it('should parse decimal with precision', () => {
      const result = parseFieldDefinition('price', 'decimal(10,2)')
      expect(result.type).toBe('decimal')
      expect(result.precision).toBe(10)
      expect(result.scale).toBe(2)
    })

    it('should parse varchar with length', () => {
      const result = parseFieldDefinition('code', 'varchar(50)')
      expect(result.type).toBe('varchar')
      expect(result.length).toBe(50)
    })

    it('should parse array type', () => {
      const result = parseFieldDefinition('tags', 'string[]')
      expect(result.type).toBe('string')
      expect(result.array).toBe(true)
    })

    it('should normalize bool to boolean', () => {
      const result = parseFieldDefinition('active', 'bool')
      expect(result.type).toBe('boolean')
    })

    it('should parse prompt field (natural language)', () => {
      const result = parseFieldDefinition('description', 'A compelling product description')
      expect(result.type).toBe('string')
      expect(result.generated).toBe(true)
      expect(result.prompt).toBe('A compelling product description')
    })

    it('should parse prompt field with question', () => {
      const result = parseFieldDefinition('challenges', 'What are their main challenges?')
      expect(result.type).toBe('string')
      expect(result.generated).toBe(true)
      expect(result.prompt).toBe('What are their main challenges?')
    })
  })

  describe('isPromptField', () => {
    it('should detect prompt fields with spaces', () => {
      expect(isPromptField('A compelling description')).toBe(true)
      expect(isPromptField('What is the purpose?')).toBe(true)
    })

    it('should not detect simple types as prompts', () => {
      expect(isPromptField('string')).toBe(false)
      expect(isPromptField('string!')).toBe(false)
      expect(isPromptField('int?')).toBe(false)
    })
  })

  describe('isRelationField', () => {
    it('should detect relation operators', () => {
      expect(isRelationField('-> User')).toBe(true)
      expect(isRelationField('<- Post.author')).toBe(true)
      expect(isRelationField('~> Category')).toBe(true)
      expect(isRelationField('<~ Product.vendor')).toBe(true)
    })

    it('should not detect regular fields', () => {
      expect(isRelationField('string')).toBe(false)
      expect(isRelationField('User')).toBe(false)
    })
  })

  describe('parseRelation', () => {
    it('should parse forward exact relation', () => {
      const result = parseRelation('-> User')
      expect(result.operator).toBe('->')
      expect(result.direction).toBe('forward')
      expect(result.matchMode).toBe('exact')
      expect(result.targetType).toBe('User')
    })

    it('should parse backward exact relation with backref', () => {
      const result = parseRelation('<- Post.author')
      expect(result.operator).toBe('<-')
      expect(result.direction).toBe('backward')
      expect(result.targetType).toBe('Post')
      expect(result.backref).toBe('author')
    })

    it('should parse forward fuzzy relation', () => {
      const result = parseRelation('~> Category')
      expect(result.operator).toBe('~>')
      expect(result.matchMode).toBe('fuzzy')
    })

    it('should parse relation with array suffix', () => {
      const result = parseRelation('<- Product.vendor[]')
      expect(result.array).toBe(true)
      expect(result.targetType).toBe('Product')
      expect(result.backref).toBe('vendor')
    })

    it('should parse optional relation', () => {
      const result = parseRelation('-> Vendor?')
      expect(result.optional).toBe(true)
      expect(result.targetType).toBe('Vendor')
    })
  })

  describe('parseSchema', () => {
    it('should parse complete database schema', () => {
      const schema = parseSchema({
        Product: {
          sku: 'string!#',
          name: 'string!',
          price: 'decimal(10,2)!',
          description: 'A compelling product description',
          vendor: '-> Vendor?',
        },
        Vendor: {
          name: 'string!',
          products: '<- Product.vendor[]',
        },
      })

      expect(schema.entities.size).toBe(2)
      expect(schema.entities.has('Product')).toBe(true)
      expect(schema.entities.has('Vendor')).toBe(true)

      const product = schema.entities.get('Product')!
      expect(product.fields.size).toBe(5)
      expect(product.fields.get('sku')!.required).toBe(true)
      expect(product.fields.get('sku')!.indexed).toBe(true)
      expect(product.fields.get('description')!.generated).toBe(true)
      expect(product.relations.get('vendor')!.targetType).toBe('Vendor')
    })

    it('should handle schema directives', () => {
      const schema = parseSchema({
        Customer: {
          $instructions: 'CRM entity for customer management',
          $fuzzyThreshold: 0.8,
          email: 'string!#',
          name: 'string!',
        },
      })

      const customer = schema.entities.get('Customer')!
      expect(customer.directives.$instructions).toBe('CRM entity for customer management')
      expect(customer.directives.$fuzzyThreshold).toBe(0.8)
      expect(customer.fields.has('email')).toBe(true)
      expect(customer.fields.has('$instructions')).toBe(false)
    })
  })
})

// =============================================================================
// WORKFLOW CONTEXT $.DB() TESTS
// =============================================================================

describe('WorkflowContext $.DB()', () => {
  let $: WorkflowContext
  let things: ThingsStore
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    things = createThingsStore()
    $ = createContext(mockState, {}, { things })
  })

  it('should register entity schemas via DB()', () => {
    $.DB({
      Product: {
        sku: 'string!#',
        name: 'string!',
        price: 'decimal(10,2)!',
      },
      Customer: {
        email: 'string!#',
        name: 'string!',
      },
    })

    // Check that schemas were registered
    expect($._entitySchemas.size).toBe(2)
    expect($._entitySchemas.has('Product')).toBe(true)
    expect($._entitySchemas.has('Customer')).toBe(true)
  })

  it('should throw if no things store configured', () => {
    const ctxWithoutThings = createContext(mockState, {})

    expect(() => {
      ctxWithoutThings.DB({ Product: { name: 'string!' } })
    }).toThrow('Cannot use $.DB() without a things store')
  })

  it('should make entity proxies available after DB() call', async () => {
    $.DB({
      Product: {
        sku: 'string!#',
        name: 'string!',
      },
    })

    // The entity proxy should now be accessible
    // Note: This depends on do-lekf.2 entity proxy implementation
    const productProxy = ($['Product' as keyof typeof $]) as unknown
    expect(productProxy).toBeDefined()
  })

  it('should register legacy schemas for entity accessor', () => {
    $.DB({
      Product: {
        sku: 'string!#',
        name: 'string!',
        price: 'decimal(10,2)!',
      },
    })

    // Check legacy schemas were also registered
    const legacySchemas = ($['_legacyEntitySchemas' as keyof typeof $]) as Map<string, unknown>
    expect(legacySchemas).toBeDefined()
    expect(legacySchemas.size).toBe(1)
    expect(legacySchemas.has('Product')).toBe(true)
  })

  describe('Entity CRUD via $.Entity after DB()', () => {
    beforeEach(() => {
      $.DB({
        Product: {
          sku: 'string!#',
          name: 'string!',
          price: 'decimal(10,2)',
        },
      })
    })

    it('should create entities with correct $type', async () => {
      const Product = ($['Product' as keyof typeof $]) as {
        create: (data: Record<string, unknown>) => Promise<{ $id: string; $type: string }>
      }

      const product = await Product.create({
        sku: 'SKU001',
        name: 'Widget',
        price: 9.99,
      })

      expect(product.$id).toBeDefined()
      expect(product.$type).toBe('Product')
    })

    it('should list entities by type', async () => {
      const Product = ($['Product' as keyof typeof $]) as {
        create: (data: Record<string, unknown>) => Promise<{ $id: string }>
        list: () => Promise<Array<{ $id: string; $type: string }>>
      }

      await Product.create({ sku: 'SKU001', name: 'Widget 1' })
      await Product.create({ sku: 'SKU002', name: 'Widget 2' })

      const products = await Product.list()
      expect(products.length).toBe(2)
      expect(products.every(p => p.$type === 'Product')).toBe(true)
    })

    it('should get entity by ID', async () => {
      const Product = ($['Product' as keyof typeof $]) as {
        create: (data: Record<string, unknown>) => Promise<{ $id: string; name: string }>
        (id: string): { get: () => Promise<{ $id: string; name: string } | null> }
      }

      const created = await Product.create({ sku: 'SKU001', name: 'Widget' })

      const fetched = await Product(created.$id).get()
      expect(fetched).toBeDefined()
      expect(fetched!.name).toBe('Widget')
    })

    it('should update entity by ID', async () => {
      const Product = ($['Product' as keyof typeof $]) as {
        create: (data: Record<string, unknown>) => Promise<{ $id: string; name: string }>
        (id: string): {
          get: () => Promise<{ $id: string; name: string } | null>
          update: (data: Record<string, unknown>) => Promise<{ $id: string; name: string }>
        }
      }

      const created = await Product.create({ sku: 'SKU001', name: 'Widget' })

      const updated = await Product(created.$id).update({ name: 'Super Widget' })
      expect(updated.name).toBe('Super Widget')

      const fetched = await Product(created.$id).get()
      expect(fetched!.name).toBe('Super Widget')
    })

    it('should delete entity by ID', async () => {
      const Product = ($['Product' as keyof typeof $]) as {
        create: (data: Record<string, unknown>) => Promise<{ $id: string }>
        (id: string): {
          get: () => Promise<{ $id: string } | null>
          delete: () => Promise<void>
        }
      }

      const created = await Product.create({ sku: 'SKU001', name: 'Widget' })

      await Product(created.$id).delete()

      const fetched = await Product(created.$id).get()
      expect(fetched).toBeNull()
    })
  })

  describe('Multiple entity types', () => {
    beforeEach(() => {
      $.DB({
        Product: {
          sku: 'string!#',
          name: 'string!',
          vendor: '-> Vendor?',
        },
        Vendor: {
          name: 'string!',
          products: '<- Product.vendor[]',
        },
        Customer: {
          email: 'string!#',
          name: 'string!',
        },
      })
    })

    it('should support multiple entity types', async () => {
      type EntityAccessor = {
        create: (data: Record<string, unknown>) => Promise<{ $id: string; $type: string }>
        list: () => Promise<Array<{ $id: string; $type: string }>>
      }

      const Product = ($['Product' as keyof typeof $]) as EntityAccessor
      const Vendor = ($['Vendor' as keyof typeof $]) as EntityAccessor
      const Customer = ($['Customer' as keyof typeof $]) as EntityAccessor

      const product = await Product.create({ sku: 'SKU001', name: 'Widget' })
      const vendor = await Vendor.create({ name: 'Acme Corp' })
      const customer = await Customer.create({ email: 'alice@example.com', name: 'Alice' })

      expect(product.$type).toBe('Product')
      expect(vendor.$type).toBe('Vendor')
      expect(customer.$type).toBe('Customer')

      const products = await Product.list()
      const vendors = await Vendor.list()
      const customers = await Customer.list()

      expect(products.length).toBe(1)
      expect(vendors.length).toBe(1)
      expect(customers.length).toBe(1)
    })
  })
})

// =============================================================================
// SCHEMA RELATION RESOLUTION TESTS
// =============================================================================

describe('Schema Relations', () => {
  it('should resolve bidirectional relations', () => {
    const schema = parseSchema({
      Product: {
        name: 'string!',
        vendor: '-> Vendor?',
      },
      Vendor: {
        name: 'string!',
        products: '<- Product.vendor[]',
      },
    })

    const product = schema.entities.get('Product')!
    const vendor = schema.entities.get('Vendor')!

    // Product.vendor -> Vendor
    expect(product.relations.get('vendor')!.targetType).toBe('Vendor')
    expect(product.relations.get('vendor')!.direction).toBe('forward')

    // Vendor.products <- Product.vendor
    expect(vendor.relations.get('products')!.targetType).toBe('Product')
    expect(vendor.relations.get('products')!.direction).toBe('backward')
    expect(vendor.relations.get('products')!.backref).toBe('vendor')
    expect(vendor.relations.get('products')!.array).toBe(true)
  })

  it('should handle fuzzy relations', () => {
    const schema = parseSchema({
      Product: {
        name: 'string!',
        category: '~> Category',
      },
      Category: {
        name: 'string!',
      },
    })

    const product = schema.entities.get('Product')!
    expect(product.relations.get('category')!.matchMode).toBe('fuzzy')
  })
})
