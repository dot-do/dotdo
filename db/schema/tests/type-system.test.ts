import { describe, it, expect } from 'vitest'

/**
 * Type System Tests for db4ai-style Cascade Generation
 *
 * This is RED phase TDD - tests should FAIL until the type system is implemented.
 *
 * The type system supports:
 * - Any In: Accept strings, arrays, objects, functions, references
 * - Strongly Typed Out: Derive Entity<T> with full type safety
 *
 * Key design principles:
 * - Schema IS workflow - relationships define generation flow
 * - ParsedField union covers all field types
 * - Entity<T> derives fields from type definition
 * - Type guards for runtime discrimination
 */

// ============================================================================
// IMPORTS - These should FAIL until implemented
// ============================================================================

// Core types - should fail until db/schema/types.ts is created
// @ts-expect-error - ParsedField types not yet implemented
import type {
  ParsedField,
  StringField,
  NumberField,
  BooleanField,
  ArrayField,
  ObjectField,
  ReferenceField,
  ComputedField,
  JSONPathField,
  PromptField,
  ParsedType,
  TypeDefinition,
  Entity,
  FieldInput,
} from '../types'

// Type guards - should fail until db/schema/type-guards.ts is created
// @ts-expect-error - Type guards not yet implemented
import {
  isStringField,
  isNumberField,
  isBooleanField,
  isArrayField,
  isObjectField,
  isReferenceField,
  isComputedField,
  isJSONPathField,
  isPromptField,
  parseFieldInput,
} from '../type-guards'

// ============================================================================
// ParsedField Union Type Tests
// ============================================================================

describe('ParsedField Union Type', () => {
  describe('StringField', () => {
    it('has kind "string"', () => {
      const field: StringField = {
        kind: 'string',
        prompt: 'What is the name?',
        required: true,
      }

      expect(field.kind).toBe('string')
      expect(field.prompt).toBe('What is the name?')
      expect(field.required).toBe(true)
    })

    it('supports optional default value', () => {
      const field: StringField = {
        kind: 'string',
        prompt: 'What is the status?',
        default: 'draft',
      }

      expect(field.default).toBe('draft')
    })

    it('supports validation constraints', () => {
      const field: StringField = {
        kind: 'string',
        prompt: 'Email address?',
        pattern: '^[a-z]+@[a-z]+\\.[a-z]+$',
        minLength: 5,
        maxLength: 100,
      }

      expect(field.pattern).toBeDefined()
      expect(field.minLength).toBe(5)
      expect(field.maxLength).toBe(100)
    })
  })

  describe('NumberField', () => {
    it('has kind "number"', () => {
      const field: NumberField = {
        kind: 'number',
        prompt: 'How many items?',
      }

      expect(field.kind).toBe('number')
    })

    it('supports min/max constraints', () => {
      const field: NumberField = {
        kind: 'number',
        prompt: 'Age?',
        min: 0,
        max: 150,
        integer: true,
      }

      expect(field.min).toBe(0)
      expect(field.max).toBe(150)
      expect(field.integer).toBe(true)
    })
  })

  describe('BooleanField', () => {
    it('has kind "boolean"', () => {
      const field: BooleanField = {
        kind: 'boolean',
        prompt: 'Is active?',
        default: false,
      }

      expect(field.kind).toBe('boolean')
      expect(field.default).toBe(false)
    })
  })

  describe('ArrayField', () => {
    it('has kind "array" with items type', () => {
      const field: ArrayField = {
        kind: 'array',
        prompt: 'List the features',
        items: { kind: 'string', prompt: 'Feature name' },
      }

      expect(field.kind).toBe('array')
      expect(field.items.kind).toBe('string')
    })

    it('supports minItems and maxItems', () => {
      const field: ArrayField = {
        kind: 'array',
        prompt: 'Tags',
        items: { kind: 'string', prompt: 'Tag' },
        minItems: 1,
        maxItems: 10,
      }

      expect(field.minItems).toBe(1)
      expect(field.maxItems).toBe(10)
    })

    it('supports array of references', () => {
      const field: ArrayField = {
        kind: 'array',
        prompt: 'Team members',
        items: {
          kind: 'reference',
          target: 'User',
          direction: 'forward',
          mode: 'exact',
        },
      }

      expect(field.items.kind).toBe('reference')
    })
  })

  describe('ObjectField', () => {
    it('has kind "object" with nested fields', () => {
      const field: ObjectField = {
        kind: 'object',
        prompt: 'Address',
        fields: {
          street: { kind: 'string', prompt: 'Street' },
          city: { kind: 'string', prompt: 'City' },
          zip: { kind: 'string', prompt: 'ZIP code' },
        },
      }

      expect(field.kind).toBe('object')
      expect(field.fields.street.kind).toBe('string')
      expect(field.fields.city.kind).toBe('string')
    })

    it('supports deeply nested objects', () => {
      const field: ObjectField = {
        kind: 'object',
        prompt: 'Location',
        fields: {
          coordinates: {
            kind: 'object',
            prompt: 'GPS coordinates',
            fields: {
              lat: { kind: 'number', prompt: 'Latitude' },
              lng: { kind: 'number', prompt: 'Longitude' },
            },
          },
        },
      }

      expect(field.fields.coordinates.kind).toBe('object')
    })
  })

  describe('ReferenceField', () => {
    it('has kind "reference" with target type', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: 'User',
        direction: 'forward',
        mode: 'exact',
      }

      expect(field.kind).toBe('reference')
      expect(field.target).toBe('User')
      expect(field.direction).toBe('forward')
      expect(field.mode).toBe('exact')
    })

    it('supports forward exact (->)', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: 'Customer',
        direction: 'forward',
        mode: 'exact',
        prompt: 'Who is the customer?',
      }

      expect(field.direction).toBe('forward')
      expect(field.mode).toBe('exact')
    })

    it('supports forward fuzzy (~>)', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: 'Category',
        direction: 'forward',
        mode: 'fuzzy',
        prompt: 'What category?',
      }

      expect(field.direction).toBe('forward')
      expect(field.mode).toBe('fuzzy')
    })

    it('supports backward exact (<-)', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: 'Post',
        direction: 'backward',
        mode: 'exact',
        prompt: 'Related posts',
      }

      expect(field.direction).toBe('backward')
      expect(field.mode).toBe('exact')
    })

    it('supports backward fuzzy (<~)', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: 'Article',
        direction: 'backward',
        mode: 'fuzzy',
        prompt: 'Similar articles',
      }

      expect(field.direction).toBe('backward')
      expect(field.mode).toBe('fuzzy')
    })

    it('supports union types (User|Org)', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: ['User', 'Organization'],
        direction: 'forward',
        mode: 'exact',
        prompt: 'Owner',
      }

      expect(Array.isArray(field.target)).toBe(true)
      expect(field.target).toContain('User')
      expect(field.target).toContain('Organization')
    })

    it('supports optional references', () => {
      const field: ReferenceField = {
        kind: 'reference',
        target: 'Manager',
        direction: 'forward',
        mode: 'exact',
        optional: true,
      }

      expect(field.optional).toBe(true)
    })
  })

  describe('ComputedField', () => {
    it('has kind "computed" with compute function', () => {
      const field: ComputedField = {
        kind: 'computed',
        compute: (entity: unknown) => (entity as { firstName: string; lastName: string }).firstName + ' ' + (entity as { firstName: string; lastName: string }).lastName,
        returnType: 'string',
      }

      expect(field.kind).toBe('computed')
      expect(typeof field.compute).toBe('function')
      expect(field.returnType).toBe('string')
    })

    it('supports async compute functions', () => {
      const field: ComputedField = {
        kind: 'computed',
        compute: async (entity: unknown) => {
          return (entity as { items: unknown[] }).items.length
        },
        returnType: 'number',
        async: true,
      }

      expect(field.async).toBe(true)
    })

    it('can depend on other fields', () => {
      const field: ComputedField = {
        kind: 'computed',
        compute: (entity: unknown) => (entity as { quantity: number; price: number }).quantity * (entity as { quantity: number; price: number }).price,
        returnType: 'number',
        dependencies: ['quantity', 'price'],
      }

      expect(field.dependencies).toContain('quantity')
      expect(field.dependencies).toContain('price')
    })
  })

  describe('JSONPathField', () => {
    it('has kind "jsonpath" with path expression', () => {
      const field: JSONPathField = {
        kind: 'jsonpath',
        path: '$.metadata.tags[*]',
        source: 'data',
      }

      expect(field.kind).toBe('jsonpath')
      expect(field.path).toBe('$.metadata.tags[*]')
      expect(field.source).toBe('data')
    })

    it('supports default when path not found', () => {
      const field: JSONPathField = {
        kind: 'jsonpath',
        path: '$.config.timeout',
        source: 'settings',
        default: 30000,
      }

      expect(field.default).toBe(30000)
    })
  })

  describe('PromptField', () => {
    it('has kind "prompt" with AI generation prompt', () => {
      const field: PromptField = {
        kind: 'prompt',
        prompt: 'Write a compelling product description for ${name}',
        model: 'gpt-4',
      }

      expect(field.kind).toBe('prompt')
      expect(field.prompt).toContain('${name}')
    })

    it('supports structured output schema', () => {
      const field: PromptField = {
        kind: 'prompt',
        prompt: 'Generate SEO metadata',
        outputSchema: {
          title: 'string',
          description: 'string',
          keywords: 'string[]',
        },
      }

      expect(field.outputSchema).toBeDefined()
      expect(field.outputSchema?.title).toBe('string')
    })

    it('supports temperature and other model params', () => {
      const field: PromptField = {
        kind: 'prompt',
        prompt: 'Generate creative tagline',
        model: 'claude-3',
        temperature: 0.9,
        maxTokens: 100,
      }

      expect(field.temperature).toBe(0.9)
      expect(field.maxTokens).toBe(100)
    })
  })
})

// ============================================================================
// Type Guards Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isStringField', () => {
    it('returns true for StringField', () => {
      const field: ParsedField = { kind: 'string', prompt: 'Name?' }
      expect(isStringField(field)).toBe(true)
    })

    it('returns false for non-StringField', () => {
      const field: ParsedField = { kind: 'number', prompt: 'Age?' }
      expect(isStringField(field)).toBe(false)
    })
  })

  describe('isReferenceField', () => {
    it('returns true for ReferenceField', () => {
      const field: ParsedField = {
        kind: 'reference',
        target: 'User',
        direction: 'forward',
        mode: 'exact',
      }
      expect(isReferenceField(field)).toBe(true)
    })

    it('returns false for non-ReferenceField', () => {
      const field: ParsedField = { kind: 'string', prompt: 'Name?' }
      expect(isReferenceField(field)).toBe(false)
    })
  })

  describe('isComputedField', () => {
    it('returns true for ComputedField', () => {
      const field: ParsedField = {
        kind: 'computed',
        compute: () => 'value',
        returnType: 'string',
      }
      expect(isComputedField(field)).toBe(true)
    })

    it('returns false for non-ComputedField', () => {
      const field: ParsedField = { kind: 'string', prompt: 'Name?' }
      expect(isComputedField(field)).toBe(false)
    })
  })

  describe('isArrayField', () => {
    it('returns true for ArrayField', () => {
      const field: ParsedField = {
        kind: 'array',
        prompt: 'Items',
        items: { kind: 'string', prompt: 'Item' },
      }
      expect(isArrayField(field)).toBe(true)
    })

    it('returns false for non-ArrayField', () => {
      const field: ParsedField = { kind: 'object', prompt: 'Data', fields: {} }
      expect(isArrayField(field)).toBe(false)
    })
  })

  describe('isObjectField', () => {
    it('returns true for ObjectField', () => {
      const field: ParsedField = {
        kind: 'object',
        prompt: 'Address',
        fields: { street: { kind: 'string', prompt: 'Street' } },
      }
      expect(isObjectField(field)).toBe(true)
    })

    it('returns false for non-ObjectField', () => {
      const field: ParsedField = { kind: 'string', prompt: 'Name?' }
      expect(isObjectField(field)).toBe(false)
    })
  })

  describe('isJSONPathField', () => {
    it('returns true for JSONPathField', () => {
      const field: ParsedField = {
        kind: 'jsonpath',
        path: '$.data.value',
        source: 'metadata',
      }
      expect(isJSONPathField(field)).toBe(true)
    })

    it('returns false for non-JSONPathField', () => {
      const field: ParsedField = { kind: 'string', prompt: 'Name?' }
      expect(isJSONPathField(field)).toBe(false)
    })
  })

  describe('isPromptField', () => {
    it('returns true for PromptField', () => {
      const field: ParsedField = {
        kind: 'prompt',
        prompt: 'Generate description',
      }
      expect(isPromptField(field)).toBe(true)
    })

    it('returns false for non-PromptField', () => {
      const field: ParsedField = { kind: 'string', prompt: 'Name?' }
      expect(isPromptField(field)).toBe(false)
    })
  })
})

// ============================================================================
// ParsedType Structure Tests
// ============================================================================

describe('ParsedType Structure', () => {
  describe('Core Properties', () => {
    it('has name property', () => {
      const type: ParsedType = {
        name: 'Customer',
        fields: {
          email: { kind: 'string', prompt: 'Email address' },
        },
        references: [],
      }

      expect(type.name).toBe('Customer')
    })

    it('has fields record', () => {
      const type: ParsedType = {
        name: 'Product',
        fields: {
          title: { kind: 'string', prompt: 'Product title' },
          price: { kind: 'number', prompt: 'Price in cents' },
        },
        references: [],
      }

      expect(type.fields.title.kind).toBe('string')
      expect(type.fields.price.kind).toBe('number')
    })

    it('has references array', () => {
      const type: ParsedType = {
        name: 'Order',
        fields: {
          customer: {
            kind: 'reference',
            target: 'Customer',
            direction: 'forward',
            mode: 'exact',
          },
        },
        references: ['customer'],
      }

      expect(type.references).toContain('customer')
    })
  })

  describe('Optional Properties', () => {
    it('supports $seed for initial data', () => {
      const type: ParsedType = {
        name: 'Category',
        fields: {
          name: { kind: 'string', prompt: 'Category name' },
        },
        references: [],
        seed: [
          { name: 'Electronics' },
          { name: 'Clothing' },
          { name: 'Books' },
        ],
      }

      expect(type.seed).toHaveLength(3)
      expect(type.seed?.[0].name).toBe('Electronics')
    })

    it('supports icon for UI display', () => {
      const type: ParsedType = {
        name: 'Task',
        fields: {
          title: { kind: 'string', prompt: 'Task title' },
        },
        references: [],
        icon: 'check-square',
      }

      expect(type.icon).toBe('check-square')
    })

    it('supports group for organization', () => {
      const type: ParsedType = {
        name: 'Invoice',
        fields: {
          total: { kind: 'number', prompt: 'Invoice total' },
        },
        references: [],
        group: 'billing',
      }

      expect(type.group).toBe('billing')
    })

    it('supports instructions for AI context', () => {
      const type: ParsedType = {
        name: 'LeanCanvas',
        fields: {
          problem: { kind: 'string', prompt: 'Problem' },
          solution: { kind: 'string', prompt: 'Solution' },
        },
        references: [],
        instructions: `
          Generate a Lean Canvas business model.
          Focus on the core problem and unique value proposition.
          Be specific and actionable.
        `,
      }

      expect(type.instructions).toContain('Lean Canvas')
    })
  })

  describe('Lifecycle Hooks', () => {
    it('supports $created hook', () => {
      const type: ParsedType = {
        name: 'Document',
        fields: {
          title: { kind: 'string', prompt: 'Title' },
        },
        references: [],
        hooks: {
          created: async (entity) => {
            // Send notification, update search index, etc.
            return entity
          },
        },
      }

      expect(type.hooks?.created).toBeDefined()
      expect(typeof type.hooks?.created).toBe('function')
    })

    it('supports $updated hook', () => {
      const type: ParsedType = {
        name: 'Document',
        fields: {
          title: { kind: 'string', prompt: 'Title' },
        },
        references: [],
        hooks: {
          updated: async (entity, changes) => {
            // Track changes, audit log, etc.
            return entity
          },
        },
      }

      expect(type.hooks?.updated).toBeDefined()
    })

    it('supports $deleted hook', () => {
      const type: ParsedType = {
        name: 'Document',
        fields: {
          title: { kind: 'string', prompt: 'Title' },
        },
        references: [],
        hooks: {
          deleted: async (entity) => {
            // Cleanup, archive, etc.
          },
        },
      }

      expect(type.hooks?.deleted).toBeDefined()
    })

    it('supports beforeCreate validation', () => {
      const type: ParsedType = {
        name: 'User',
        fields: {
          email: { kind: 'string', prompt: 'Email' },
        },
        references: [],
        hooks: {
          beforeCreate: async (data) => {
            if (!data.email.includes('@')) {
              throw new Error('Invalid email')
            }
            return data
          },
        },
      }

      expect(type.hooks?.beforeCreate).toBeDefined()
    })
  })
})

// ============================================================================
// Entity<T> Type Inference Tests
// ============================================================================

describe('Entity<T> Type Inference', () => {
  describe('String prompt yields string', () => {
    it('infers string type from string prompt', () => {
      type CustomerDef = {
        name: 'What is the customer name?'
        email: 'Email address?'
      }

      type CustomerEntity = Entity<CustomerDef>

      // This should compile - demonstrating type inference
      const customer: CustomerEntity = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'John Doe',
        email: 'john@example.com',
      }

      expect(customer.$id).toBe('cust-001')
      expect(customer.name).toBe('John Doe')
      expect(typeof customer.email).toBe('string')
    })
  })

  describe('Array prompt yields string[]', () => {
    it('infers string[] from array field', () => {
      type ProductDef = {
        name: 'Product name?'
        tags: ['What tags describe this product?']
      }

      type ProductEntity = Entity<ProductDef>

      const product: ProductEntity = {
        $id: 'prod-001',
        $type: 'Product',
        name: 'Widget',
        tags: ['electronics', 'gadget', 'useful'],
      }

      expect(product.tags).toHaveLength(3)
      expect(product.tags[0]).toBe('electronics')
    })
  })

  describe('Nested object yields nested Entity', () => {
    it('infers nested structure from object field', () => {
      type CompanyDef = {
        name: 'Company name?'
        address: {
          street: 'Street address?'
          city: 'City?'
          country: 'Country?'
        }
      }

      type CompanyEntity = Entity<CompanyDef>

      const company: CompanyEntity = {
        $id: 'comp-001',
        $type: 'Company',
        name: 'Acme Corp',
        address: {
          street: '123 Main St',
          city: 'Springfield',
          country: 'USA',
        },
      }

      expect(company.address.city).toBe('Springfield')
    })
  })

  describe('Computed field yields return type', () => {
    it('infers return type from computed function', () => {
      type OrderDef = {
        quantity: 'How many items?'
        unitPrice: 'Price per item?'
        total: (order: { quantity: number; unitPrice: number }) => number
      }

      type OrderEntity = Entity<OrderDef>

      const order: OrderEntity = {
        $id: 'ord-001',
        $type: 'Order',
        quantity: 5,
        unitPrice: 1000,
        total: 5000,
      }

      expect(order.total).toBe(5000)
      expect(typeof order.total).toBe('number')
    })
  })

  describe('Reference yields linked Entity type', () => {
    it('infers reference type from -> operator', () => {
      type OrderDef = {
        customer: '->Customer'
        items: ['->OrderItem']
      }

      type CustomerEntity = {
        $id: string
        $type: 'Customer'
        name: string
        email: string
      }

      type OrderItemEntity = {
        $id: string
        $type: 'OrderItem'
        product: string
        quantity: number
      }

      type OrderEntity = Entity<OrderDef>

      // The order should have typed references
      const order: OrderEntity = {
        $id: 'ord-001',
        $type: 'Order',
        customer: { $id: 'cust-001', $type: 'Customer', name: 'John', email: 'john@example.com' },
        items: [
          { $id: 'item-001', $type: 'OrderItem', product: 'Widget', quantity: 2 },
        ],
      }

      expect(order.customer.$id).toBe('cust-001')
      expect(order.items[0].quantity).toBe(2)
    })
  })

  describe('$id and $type always present', () => {
    it('every Entity has $id string field', () => {
      type MinimalDef = {
        value: 'Some value?'
      }

      type MinimalEntity = Entity<MinimalDef>

      const entity: MinimalEntity = {
        $id: 'entity-001',
        $type: 'Minimal',
        value: 'test',
      }

      expect(entity.$id).toBeDefined()
      expect(typeof entity.$id).toBe('string')
    })

    it('every Entity has $type string field', () => {
      type MinimalDef = {
        value: 'Some value?'
      }

      type MinimalEntity = Entity<MinimalDef>

      const entity: MinimalEntity = {
        $id: 'entity-001',
        $type: 'Minimal',
        value: 'test',
      }

      expect(entity.$type).toBeDefined()
      expect(typeof entity.$type).toBe('string')
    })
  })
})

// ============================================================================
// Type Coercion (Any In) Tests
// ============================================================================

describe('Type Coercion (Any In)', () => {
  describe('String input normalization', () => {
    it('converts simple string to StringField', () => {
      const input: FieldInput = 'What is the name?'
      const field = parseFieldInput(input)

      expect(field.kind).toBe('string')
      expect((field as StringField).prompt).toBe('What is the name?')
    })

    it('extracts prompt from string with reference operator', () => {
      const input: FieldInput = 'Who is the owner? ->User'
      const field = parseFieldInput(input)

      expect(field.kind).toBe('reference')
      expect((field as ReferenceField).prompt).toBe('Who is the owner?')
      expect((field as ReferenceField).target).toBe('User')
    })
  })

  describe('Array input normalization', () => {
    it('converts string array to ArrayField of strings', () => {
      const input: FieldInput = ['What are the tags?']
      const field = parseFieldInput(input)

      expect(field.kind).toBe('array')
      expect((field as ArrayField).items.kind).toBe('string')
    })

    it('converts reference array to ArrayField of references', () => {
      const input: FieldInput = ['->OrderItem']
      const field = parseFieldInput(input)

      expect(field.kind).toBe('array')
      expect((field as ArrayField).items.kind).toBe('reference')
    })
  })

  describe('Object input normalization', () => {
    it('converts nested object to ObjectField', () => {
      const input: FieldInput = {
        street: 'Street address?',
        city: 'City name?',
      }
      const field = parseFieldInput(input)

      expect(field.kind).toBe('object')
      expect((field as ObjectField).fields.street.kind).toBe('string')
    })
  })

  describe('Function input normalization', () => {
    it('converts function to ComputedField', () => {
      const input: FieldInput = (entity: { a: number; b: number }) => entity.a + entity.b
      const field = parseFieldInput(input)

      expect(field.kind).toBe('computed')
      expect(typeof (field as ComputedField).compute).toBe('function')
    })
  })

  describe('Reference operator parsing', () => {
    it('parses -> as forward exact', () => {
      const input: FieldInput = '->Customer'
      const field = parseFieldInput(input)

      expect(field.kind).toBe('reference')
      expect((field as ReferenceField).direction).toBe('forward')
      expect((field as ReferenceField).mode).toBe('exact')
    })

    it('parses ~> as forward fuzzy', () => {
      const input: FieldInput = '~>Category'
      const field = parseFieldInput(input)

      expect(field.kind).toBe('reference')
      expect((field as ReferenceField).direction).toBe('forward')
      expect((field as ReferenceField).mode).toBe('fuzzy')
    })

    it('parses <- as backward exact', () => {
      const input: FieldInput = '<-Post'
      const field = parseFieldInput(input)

      expect(field.kind).toBe('reference')
      expect((field as ReferenceField).direction).toBe('backward')
      expect((field as ReferenceField).mode).toBe('exact')
    })

    it('parses <~ as backward fuzzy', () => {
      const input: FieldInput = '<~Article'
      const field = parseFieldInput(input)

      expect(field.kind).toBe('reference')
      expect((field as ReferenceField).direction).toBe('backward')
      expect((field as ReferenceField).mode).toBe('fuzzy')
    })
  })
})

// ============================================================================
// Strong Output Types Tests
// ============================================================================

describe('Strong Output Types', () => {
  describe('Entity derives fields from definition', () => {
    it('Entity has all defined fields typed correctly', () => {
      type StartupDef = {
        name: 'What is the startup name?'
        idea: 'What is the core idea?'
        founders: ['->Founder']
        funding: {
          raised: 'Total raised?'
          stage: 'Current stage?'
        }
      }

      type StartupEntity = Entity<StartupDef>

      // Type should enforce all fields
      const startup: StartupEntity = {
        $id: 'startup-001',
        $type: 'Startup',
        name: 'Acme Inc',
        idea: 'Revolutionary widget',
        founders: [],
        funding: {
          raised: '$1M',
          stage: 'Seed',
        },
      }

      expect(startup.name).toBe('Acme Inc')
      expect(startup.funding.stage).toBe('Seed')
    })

    it('Entity rejects extra fields at compile time', () => {
      type StrictDef = {
        name: 'Name?'
      }

      type StrictEntity = Entity<StrictDef>

      // This should cause a type error if strict typing is enforced
      const entity: StrictEntity = {
        $id: 'strict-001',
        $type: 'Strict',
        name: 'Test',
        // @ts-expect-error - extra field should not be allowed
        extraField: 'should fail',
      }

      expect(entity.name).toBe('Test')
    })
  })

  describe('Relationships typed correctly', () => {
    it('single reference is correctly typed', () => {
      type PostDef = {
        title: 'Title?'
        author: '->User'
      }

      type UserEntity = {
        $id: string
        $type: 'User'
        name: string
      }

      type PostEntity = Entity<PostDef>

      const post: PostEntity = {
        $id: 'post-001',
        $type: 'Post',
        title: 'Hello World',
        author: { $id: 'user-001', $type: 'User', name: 'John' },
      }

      expect(post.author.name).toBe('John')
    })

    it('array reference is correctly typed', () => {
      type BlogDef = {
        title: 'Title?'
        posts: ['->Post']
      }

      type PostEntity = {
        $id: string
        $type: 'Post'
        title: string
      }

      type BlogEntity = Entity<BlogDef>

      const blog: BlogEntity = {
        $id: 'blog-001',
        $type: 'Blog',
        title: 'My Blog',
        posts: [
          { $id: 'post-001', $type: 'Post', title: 'First' },
          { $id: 'post-002', $type: 'Post', title: 'Second' },
        ],
      }

      expect(blog.posts.length).toBe(2)
      expect(blog.posts[0].title).toBe('First')
    })

    it('optional reference can be undefined', () => {
      type EmployeeDef = {
        name: 'Name?'
        manager: '->Employee?' // Optional reference
      }

      type EmployeeEntity = Entity<EmployeeDef>

      const employee: EmployeeEntity = {
        $id: 'emp-001',
        $type: 'Employee',
        name: 'John',
        manager: undefined, // CEO has no manager
      }

      expect(employee.manager).toBeUndefined()
    })
  })

  describe('Timestamps and metadata', () => {
    it('Entity can include $createdAt', () => {
      type DocumentDef = {
        title: 'Title?'
      }

      type DocumentEntity = Entity<DocumentDef> & {
        $createdAt: Date
        $updatedAt: Date
      }

      const doc: DocumentEntity = {
        $id: 'doc-001',
        $type: 'Document',
        title: 'Test',
        $createdAt: new Date('2024-01-01'),
        $updatedAt: new Date('2024-01-02'),
      }

      expect(doc.$createdAt).toBeInstanceOf(Date)
    })

    it('Entity can include $version for optimistic locking', () => {
      type ConfigDef = {
        setting: 'Setting value?'
      }

      type ConfigEntity = Entity<ConfigDef> & {
        $version: number
      }

      const config: ConfigEntity = {
        $id: 'config-001',
        $type: 'Config',
        setting: 'value',
        $version: 3,
      }

      expect(config.$version).toBe(3)
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty type definitions', () => {
    it('handles type with no fields', () => {
      type EmptyDef = Record<string, never>
      type EmptyEntity = Entity<EmptyDef>

      const entity: EmptyEntity = {
        $id: 'empty-001',
        $type: 'Empty',
      }

      expect(entity.$id).toBeDefined()
    })
  })

  describe('Circular references', () => {
    it('handles self-referencing types', () => {
      type TreeNodeDef = {
        value: 'Value?'
        parent: '->TreeNode?'
        children: ['->TreeNode']
      }

      // Type should handle circular reference without infinite recursion
      type TreeNodeEntity = Entity<TreeNodeDef>

      const node: TreeNodeEntity = {
        $id: 'node-001',
        $type: 'TreeNode',
        value: 'root',
        parent: undefined,
        children: [],
      }

      expect(node.value).toBe('root')
    })
  })

  describe('Union reference types', () => {
    it('handles union of reference targets', () => {
      type CommentDef = {
        content: 'Comment text?'
        target: '->Post|Article|Video'
      }

      type CommentEntity = Entity<CommentDef>

      const comment: CommentEntity = {
        $id: 'comment-001',
        $type: 'Comment',
        content: 'Great post!',
        target: { $id: 'post-001', $type: 'Post', title: 'Hello' },
      }

      expect(comment.target.$type).toBe('Post')
    })
  })
})
