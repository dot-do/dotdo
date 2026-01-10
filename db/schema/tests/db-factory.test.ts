/**
 * DB() Factory and parseSchema() Tests
 *
 * RED phase TDD tests for the schema core system.
 * These tests define the expected interface for db4ai-style cascade schema.
 *
 * Tests should FAIL until db-factory.ts and parse-schema.ts are implemented.
 *
 * Schema format:
 * ```typescript
 * const schema = DB({
 *   $id: 'https://startup.db.sb',
 *   $context: 'namespace',
 *   $version: '1.0.0',
 *   Startup: {
 *     idea: 'What is the idea? <-Idea',
 *     customer: '~>IdealCustomerProfile',
 *     founders: ['->Founder'],
 *     businessModel: '->LeanCanvas',
 *   },
 * })
 * ```
 *
 * @see db/schema/README.md
 */

import { describe, it, expect } from 'vitest'

// These imports should FAIL until implemented
import { DB } from '../db-factory'
import {
  parseSchema,
  type ParsedSchema,
  type ParsedType,
  type ParsedField,
  type SchemaDefinition,
  type SchemaMetadata,
} from '../parse-schema'

// ============================================================================
// Test Fixtures - Schema Definitions
// ============================================================================

/**
 * Minimal valid schema with one type
 */
const MINIMAL_SCHEMA = {
  $id: 'https://minimal.db.sb',
  User: {
    name: 'string',
    email: 'string',
  },
}

/**
 * Complete startup schema matching the dotdo example
 */
const STARTUP_SCHEMA = {
  $id: 'https://startup.db.sb',
  $context: 'startup',
  $version: '1.0.0',
  Startup: {
    idea: 'What is the idea? <-Idea',
    customer: '~>IdealCustomerProfile',
    founders: ['->Founder'],
    businessModel: '->LeanCanvas',
  },
  Idea: {
    description: 'string',
    problem: 'string',
    solution: 'string',
  },
  IdealCustomerProfile: {
    demographics: 'string',
    painPoints: ['string'],
    behaviors: ['string'],
  },
  Founder: {
    name: 'string',
    role: 'string',
    equity: 'number',
  },
  LeanCanvas: {
    problem: ['string'],
    solution: 'string',
    uniqueValueProp: 'string',
    unfairAdvantage: 'string?',
    customerSegments: ['string'],
    channels: ['string'],
    revenueStreams: ['string'],
    costStructure: ['string'],
    keyMetrics: ['string'],
  },
}

/**
 * Schema with all four cascade operators
 */
const CASCADE_OPERATORS_SCHEMA = {
  $id: 'https://cascade.db.sb',
  Document: {
    forwardInsert: '->Section',
    forwardSearch: '~>Template',
    backwardInsert: '<-Author',
    backwardSearch: '<~Category',
  },
}

/**
 * Schema with $fn schema-level functions
 */
const SCHEMA_WITH_FUNCTIONS = {
  $id: 'https://functions.db.sb',
  $fn: {
    validate: (entity: unknown) => true,
    beforeSave: (entity: unknown) => entity,
    afterCreate: (entity: unknown) => console.log('Created'),
  },
  Entity: {
    name: 'string',
  },
}

/**
 * Schema with nested type definitions
 */
const NESTED_TYPES_SCHEMA = {
  $id: 'https://nested.db.sb',
  Order: {
    customer: '->Customer',
    items: [
      {
        product: '->Product',
        quantity: 'number',
        price: 'number',
      },
    ],
    shipping: {
      address: 'string',
      city: 'string',
      zip: 'string',
      country: 'string',
    },
  },
  Customer: {
    name: 'string',
    email: 'string',
  },
  Product: {
    name: 'string',
    sku: 'string',
    price: 'number',
  },
}

/**
 * Schema with question marks (optional fields)
 */
const OPTIONAL_FIELDS_SCHEMA = {
  $id: 'https://optional.db.sb',
  Profile: {
    name: 'string',
    bio: 'string?',
    avatar: 'string?',
    website: 'string?',
    social: {
      twitter: 'string?',
      github: 'string?',
      linkedin: 'string?',
    },
  },
}

// ============================================================================
// DB() Factory Tests
// ============================================================================

describe('DB() Factory', () => {
  describe('Basic Schema Creation', () => {
    it('creates schema from minimal object definition', () => {
      const schema = DB(MINIMAL_SCHEMA)

      expect(schema).toBeDefined()
      expect(typeof schema).toBe('object')
    })

    it('returns typed schema object', () => {
      const schema = DB(MINIMAL_SCHEMA)

      // Schema should have getType method
      expect(typeof schema.getType).toBe('function')
    })

    it('preserves type definitions', () => {
      const schema = DB(MINIMAL_SCHEMA)

      const userType = schema.getType('User')
      expect(userType).toBeDefined()
      expect(userType?.name).toBe('User')
    })

    it('creates schema from complete startup definition', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema).toBeDefined()
      expect(schema.getType('Startup')).toBeDefined()
      expect(schema.getType('Idea')).toBeDefined()
      expect(schema.getType('Founder')).toBeDefined()
      expect(schema.getType('LeanCanvas')).toBeDefined()
    })
  })

  describe('Metadata Extraction', () => {
    it('extracts $id metadata', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema.$id).toBe('https://startup.db.sb')
    })

    it('extracts $context metadata', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema.$context).toBe('startup')
    })

    it('extracts $version metadata', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema.$version).toBe('1.0.0')
    })

    it('returns undefined for missing metadata', () => {
      const schema = DB(MINIMAL_SCHEMA)

      expect(schema.$context).toBeUndefined()
      expect(schema.$version).toBeUndefined()
    })

    it('extracts $fn schema-level functions', () => {
      const schema = DB(SCHEMA_WITH_FUNCTIONS)

      expect(schema.$fn).toBeDefined()
      expect(typeof schema.$fn?.validate).toBe('function')
      expect(typeof schema.$fn?.beforeSave).toBe('function')
      expect(typeof schema.$fn?.afterCreate).toBe('function')
    })
  })

  describe('Type Registry', () => {
    it('provides types Map for iteration', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema.types).toBeDefined()
      expect(schema.types instanceof Map).toBe(true)
    })

    it('types Map contains all defined types', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema.types.size).toBe(5) // Startup, Idea, ICP, Founder, LeanCanvas
      expect(schema.types.has('Startup')).toBe(true)
      expect(schema.types.has('Idea')).toBe(true)
    })

    it('does not include $ directives in types Map', () => {
      const schema = DB(STARTUP_SCHEMA)

      expect(schema.types.has('$id')).toBe(false)
      expect(schema.types.has('$context')).toBe(false)
      expect(schema.types.has('$version')).toBe(false)
    })
  })

  describe('Error Handling', () => {
    it('throws on null input', () => {
      expect(() => DB(null as unknown as SchemaDefinition)).toThrow()
    })

    it('throws on undefined input', () => {
      expect(() => DB(undefined as unknown as SchemaDefinition)).toThrow()
    })

    it('throws on non-object input', () => {
      expect(() => DB('string' as unknown as SchemaDefinition)).toThrow()
      expect(() => DB(123 as unknown as SchemaDefinition)).toThrow()
      expect(() => DB([] as unknown as SchemaDefinition)).toThrow()
    })

    it('throws on schema without any types', () => {
      const noTypes = {
        $id: 'https://empty.db.sb',
      }

      expect(() => DB(noTypes)).toThrow()
    })

    it('throws descriptive error for invalid schema', () => {
      try {
        DB(null as unknown as SchemaDefinition)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain('invalid')
      }
    })
  })
})

// ============================================================================
// parseSchema() Tests
// ============================================================================

describe('parseSchema()', () => {
  describe('Type Extraction', () => {
    it('parses entity definitions into ParsedType[]', () => {
      const result = parseSchema(MINIMAL_SCHEMA)

      expect(result.types).toBeDefined()
      expect(Array.isArray(result.types)).toBe(true)
      expect(result.types.length).toBe(1)
    })

    it('extracts type names from PascalCase keys', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      const typeNames = result.types.map((t) => t.name)
      expect(typeNames).toContain('Startup')
      expect(typeNames).toContain('Idea')
      expect(typeNames).toContain('IdealCustomerProfile')
      expect(typeNames).toContain('Founder')
      expect(typeNames).toContain('LeanCanvas')
    })

    it('ignores lowercase keys as types', () => {
      const schemaWithLowercase = {
        $id: 'https://test.db.sb',
        User: { name: 'string' },
        helper: 'not a type',
        utility: { data: 'ignored' },
      }

      const result = parseSchema(schemaWithLowercase)

      const typeNames = result.types.map((t) => t.name)
      expect(typeNames).toContain('User')
      expect(typeNames).not.toContain('helper')
      expect(typeNames).not.toContain('utility')
    })

    it('identifies PascalCase correctly', () => {
      const schemaWithVariedCasing = {
        $id: 'https://test.db.sb',
        User: { name: 'string' },
        UserProfile: { bio: 'string' },
        HTTPClient: { url: 'string' },
        XMLParser: { data: 'string' },
        // These should be ignored
        userId: 'ignored',
        camelCase: { ignored: true },
        snake_case: { ignored: true },
        'kebab-case': { ignored: true },
      }

      const result = parseSchema(schemaWithVariedCasing)

      const typeNames = result.types.map((t) => t.name)
      expect(typeNames).toContain('User')
      expect(typeNames).toContain('UserProfile')
      expect(typeNames).toContain('HTTPClient')
      expect(typeNames).toContain('XMLParser')
      expect(typeNames).not.toContain('userId')
      expect(typeNames).not.toContain('camelCase')
    })
  })

  describe('$ Directive Separation', () => {
    it('separates $ directives from type fields', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(result.metadata.$id).toBe('https://startup.db.sb')
      expect(result.metadata.$context).toBe('startup')
      expect(result.metadata.$version).toBe('1.0.0')
    })

    it('does not include $ directives as type fields', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      result.types.forEach((type) => {
        type.fields.forEach((field) => {
          expect(field.name.startsWith('$')).toBe(false)
        })
      })
    })

    it('extracts $fn functions as separate metadata', () => {
      const result = parseSchema(SCHEMA_WITH_FUNCTIONS)

      expect(result.metadata.$fn).toBeDefined()
      expect(typeof result.metadata.$fn?.validate).toBe('function')
    })

    it('handles schema with only $id and types', () => {
      const result = parseSchema(MINIMAL_SCHEMA)

      expect(result.metadata.$id).toBe('https://minimal.db.sb')
      expect(result.metadata.$context).toBeUndefined()
      expect(result.metadata.$version).toBeUndefined()
    })
  })

  describe('Field Parsing', () => {
    it('parses simple string fields', () => {
      const result = parseSchema(MINIMAL_SCHEMA)

      const userType = result.types.find((t) => t.name === 'User')
      expect(userType?.fields).toHaveLength(2)

      const nameField = userType?.fields.find((f) => f.name === 'name')
      expect(nameField?.type).toBe('string')
      expect(nameField?.required).toBe(true)
    })

    it('parses optional fields (string?)', () => {
      const result = parseSchema(OPTIONAL_FIELDS_SCHEMA)

      const profileType = result.types.find((t) => t.name === 'Profile')
      const bioField = profileType?.fields.find((f) => f.name === 'bio')

      expect(bioField?.type).toBe('string')
      expect(bioField?.required).toBe(false)
    })

    it('parses array fields', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      const icpType = result.types.find((t) => t.name === 'IdealCustomerProfile')
      const painPointsField = icpType?.fields.find((f) => f.name === 'painPoints')

      expect(painPointsField?.isArray).toBe(true)
      expect(painPointsField?.type).toBe('string')
    })

    it('parses reference fields with cascade operators', () => {
      const result = parseSchema(CASCADE_OPERATORS_SCHEMA)

      const docType = result.types.find((t) => t.name === 'Document')

      const forwardInsert = docType?.fields.find((f) => f.name === 'forwardInsert')
      expect(forwardInsert?.reference).toBe('Section')
      expect(forwardInsert?.operator).toBe('->')

      const forwardSearch = docType?.fields.find((f) => f.name === 'forwardSearch')
      expect(forwardSearch?.reference).toBe('Template')
      expect(forwardSearch?.operator).toBe('~>')

      const backwardInsert = docType?.fields.find((f) => f.name === 'backwardInsert')
      expect(backwardInsert?.reference).toBe('Author')
      expect(backwardInsert?.operator).toBe('<-')

      const backwardSearch = docType?.fields.find((f) => f.name === 'backwardSearch')
      expect(backwardSearch?.reference).toBe('Category')
      expect(backwardSearch?.operator).toBe('<~')
    })

    it('parses fields with prompt text', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      const startupType = result.types.find((t) => t.name === 'Startup')
      const ideaField = startupType?.fields.find((f) => f.name === 'idea')

      expect(ideaField?.prompt).toBe('What is the idea?')
      expect(ideaField?.operator).toBe('<-')
      expect(ideaField?.reference).toBe('Idea')
    })

    it('parses array of references', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      const startupType = result.types.find((t) => t.name === 'Startup')
      const foundersField = startupType?.fields.find((f) => f.name === 'founders')

      expect(foundersField?.isArray).toBe(true)
      expect(foundersField?.operator).toBe('->')
      expect(foundersField?.reference).toBe('Founder')
    })
  })

  describe('Nested Type Definitions', () => {
    it('parses inline nested objects', () => {
      const result = parseSchema(NESTED_TYPES_SCHEMA)

      const orderType = result.types.find((t) => t.name === 'Order')
      const shippingField = orderType?.fields.find((f) => f.name === 'shipping')

      expect(shippingField?.isNested).toBe(true)
      expect(shippingField?.nestedFields).toBeDefined()
      expect(shippingField?.nestedFields).toHaveLength(4)
    })

    it('extracts nested field names correctly', () => {
      const result = parseSchema(NESTED_TYPES_SCHEMA)

      const orderType = result.types.find((t) => t.name === 'Order')
      const shippingField = orderType?.fields.find((f) => f.name === 'shipping')

      const nestedNames = shippingField?.nestedFields?.map((f) => f.name)
      expect(nestedNames).toContain('address')
      expect(nestedNames).toContain('city')
      expect(nestedNames).toContain('zip')
      expect(nestedNames).toContain('country')
    })

    it('parses arrays of nested objects', () => {
      const result = parseSchema(NESTED_TYPES_SCHEMA)

      const orderType = result.types.find((t) => t.name === 'Order')
      const itemsField = orderType?.fields.find((f) => f.name === 'items')

      expect(itemsField?.isArray).toBe(true)
      expect(itemsField?.isNested).toBe(true)
      expect(itemsField?.nestedFields).toHaveLength(3)
    })

    it('handles nested objects with references', () => {
      const result = parseSchema(NESTED_TYPES_SCHEMA)

      const orderType = result.types.find((t) => t.name === 'Order')
      const itemsField = orderType?.fields.find((f) => f.name === 'items')

      const productField = itemsField?.nestedFields?.find((f) => f.name === 'product')
      expect(productField?.operator).toBe('->')
      expect(productField?.reference).toBe('Product')
    })

    it('handles deeply nested structures', () => {
      const deeplyNested = {
        $id: 'https://deep.db.sb',
        Config: {
          settings: {
            display: {
              theme: {
                primary: 'string',
                secondary: 'string',
              },
            },
          },
        },
      }

      const result = parseSchema(deeplyNested)

      const configType = result.types.find((t) => t.name === 'Config')
      expect(configType?.fields.find((f) => f.name === 'settings')?.isNested).toBe(true)
    })
  })

  describe('Schema Result Structure', () => {
    it('returns ParsedSchema with metadata and types', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(result.metadata).toBeDefined()
      expect(result.types).toBeDefined()
      expect(typeof result.metadata).toBe('object')
      expect(Array.isArray(result.types)).toBe(true)
    })

    it('includes getType helper on result', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(typeof result.getType).toBe('function')
      expect(result.getType('Startup')).toBeDefined()
      expect(result.getType('NonExistent')).toBeUndefined()
    })

    it('includes hasType helper on result', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(typeof result.hasType).toBe('function')
      expect(result.hasType('Startup')).toBe(true)
      expect(result.hasType('NonExistent')).toBe(false)
    })

    it('includes getFieldsForType helper on result', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(typeof result.getFieldsForType).toBe('function')

      const startupFields = result.getFieldsForType('Startup')
      expect(startupFields).toHaveLength(4)

      const nonExistentFields = result.getFieldsForType('NonExistent')
      expect(nonExistentFields).toEqual([])
    })
  })
})

// ============================================================================
// Schema Metadata Tests
// ============================================================================

describe('Schema Metadata', () => {
  describe('$id: Schema Identifier', () => {
    it('$id is extracted as URL string', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(result.metadata.$id).toBe('https://startup.db.sb')
      expect(typeof result.metadata.$id).toBe('string')
    })

    it('$id can be any valid URL', () => {
      const schemas = [
        { $id: 'https://example.com/schema/v1', User: { name: 'string' } },
        { $id: 'https://api.example.com/schemas/user', User: { name: 'string' } },
        { $id: 'db://local/myschema', User: { name: 'string' } },
        { $id: 'urn:schema:user:v1', User: { name: 'string' } },
      ]

      schemas.forEach((schemaInput) => {
        const result = parseSchema(schemaInput)
        expect(result.metadata.$id).toBe(schemaInput.$id)
      })
    })

    it('schema without $id has undefined $id', () => {
      const noId = {
        User: { name: 'string' },
      }

      const result = parseSchema(noId)
      expect(result.metadata.$id).toBeUndefined()
    })
  })

  describe('$context: Namespace', () => {
    it('$context is extracted as namespace string', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(result.metadata.$context).toBe('startup')
    })

    it('$context can be hierarchical', () => {
      const hierarchical = {
        $id: 'https://test.db.sb',
        $context: 'com.example.users',
        User: { name: 'string' },
      }

      const result = parseSchema(hierarchical)
      expect(result.metadata.$context).toBe('com.example.users')
    })

    it('schema without $context has undefined $context', () => {
      const result = parseSchema(MINIMAL_SCHEMA)

      expect(result.metadata.$context).toBeUndefined()
    })
  })

  describe('$version: Schema Version', () => {
    it('$version is extracted as version string', () => {
      const result = parseSchema(STARTUP_SCHEMA)

      expect(result.metadata.$version).toBe('1.0.0')
    })

    it('$version follows semver format', () => {
      const versions = [
        { $id: 'test', $version: '0.0.1', User: { name: 'string' } },
        { $id: 'test', $version: '1.0.0', User: { name: 'string' } },
        { $id: 'test', $version: '2.3.4', User: { name: 'string' } },
        { $id: 'test', $version: '10.20.30', User: { name: 'string' } },
      ]

      versions.forEach((schemaInput) => {
        const result = parseSchema(schemaInput)
        expect(result.metadata.$version).toBe(schemaInput.$version)
      })
    })

    it('$version can include prerelease tags', () => {
      const prerelease = {
        $id: 'test',
        $version: '1.0.0-beta.1',
        User: { name: 'string' },
      }

      const result = parseSchema(prerelease)
      expect(result.metadata.$version).toBe('1.0.0-beta.1')
    })

    it('schema without $version has undefined $version', () => {
      const result = parseSchema(MINIMAL_SCHEMA)

      expect(result.metadata.$version).toBeUndefined()
    })
  })

  describe('$fn: Schema-level Functions', () => {
    it('$fn is extracted as function object', () => {
      const result = parseSchema(SCHEMA_WITH_FUNCTIONS)

      expect(result.metadata.$fn).toBeDefined()
      expect(typeof result.metadata.$fn).toBe('object')
    })

    it('$fn functions are callable', () => {
      const result = parseSchema(SCHEMA_WITH_FUNCTIONS)

      expect(typeof result.metadata.$fn?.validate).toBe('function')
      expect(result.metadata.$fn?.validate({})).toBe(true)
    })

    it('$fn can have multiple function types', () => {
      const multipleFns = {
        $id: 'test',
        $fn: {
          onCreate: () => {},
          onUpdate: () => {},
          onDelete: () => {},
          validate: () => true,
          transform: (x: unknown) => x,
          authorize: () => true,
        },
        User: { name: 'string' },
      }

      const result = parseSchema(multipleFns)

      expect(Object.keys(result.metadata.$fn || {})).toHaveLength(6)
    })

    it('schema without $fn has undefined $fn', () => {
      const result = parseSchema(MINIMAL_SCHEMA)

      expect(result.metadata.$fn).toBeUndefined()
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  it('DB() returns correctly typed schema', () => {
    const schema = DB(MINIMAL_SCHEMA)

    // This should compile - testing type inference
    const user = schema.getType('User')
    if (user) {
      const nameField = user.fields.find((f) => f.name === 'name')
      expect(nameField).toBeDefined()
    }
  })

  it('ParsedType has correct structure', () => {
    const result = parseSchema(MINIMAL_SCHEMA)
    const userType = result.types[0]

    // Type should have these properties
    expect(userType).toHaveProperty('name')
    expect(userType).toHaveProperty('fields')
    expect(typeof userType.name).toBe('string')
    expect(Array.isArray(userType.fields)).toBe(true)
  })

  it('ParsedField has correct structure', () => {
    const result = parseSchema(STARTUP_SCHEMA)
    const startupType = result.types.find((t) => t.name === 'Startup')
    const ideaField = startupType?.fields.find((f) => f.name === 'idea')

    if (ideaField) {
      // Required properties
      expect(ideaField).toHaveProperty('name')
      expect(ideaField).toHaveProperty('type')
      expect(ideaField).toHaveProperty('required')

      // Optional properties for references
      expect(ideaField).toHaveProperty('operator')
      expect(ideaField).toHaveProperty('reference')
      expect(ideaField).toHaveProperty('prompt')
    }
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty and Minimal Schemas', () => {
    it('handles schema with single type', () => {
      const single = {
        $id: 'test',
        User: { id: 'string' },
      }

      const result = parseSchema(single)
      expect(result.types).toHaveLength(1)
    })

    it('handles type with single field', () => {
      const single = {
        $id: 'test',
        User: { id: 'string' },
      }

      const result = parseSchema(single)
      expect(result.types[0].fields).toHaveLength(1)
    })

    it('handles type with no fields (empty object)', () => {
      const empty = {
        $id: 'test',
        EmptyType: {},
      }

      const result = parseSchema(empty)
      const emptyType = result.types.find((t) => t.name === 'EmptyType')
      expect(emptyType?.fields).toHaveLength(0)
    })
  })

  describe('Special Characters', () => {
    it('handles field names with underscores', () => {
      const underscores = {
        $id: 'test',
        User: {
          first_name: 'string',
          last_name: 'string',
          created_at: 'string',
        },
      }

      const result = parseSchema(underscores)
      const userType = result.types.find((t) => t.name === 'User')

      expect(userType?.fields.find((f) => f.name === 'first_name')).toBeDefined()
      expect(userType?.fields.find((f) => f.name === 'last_name')).toBeDefined()
      expect(userType?.fields.find((f) => f.name === 'created_at')).toBeDefined()
    })

    it('handles type names with numbers', () => {
      const numbered = {
        $id: 'test',
        User2: { name: 'string' },
        Config123: { value: 'string' },
      }

      const result = parseSchema(numbered)

      expect(result.hasType('User2')).toBe(true)
      expect(result.hasType('Config123')).toBe(true)
    })

    it('handles unicode in field values', () => {
      const unicode = {
        $id: 'test',
        User: {
          greeting: 'What is your greeting? \u2764',
        },
      }

      const result = parseSchema(unicode)
      const greetingField = result.types[0].fields[0]

      expect(greetingField.prompt).toContain('\u2764')
    })
  })

  describe('Complex Reference Patterns', () => {
    it('handles multiple operators in same type', () => {
      const result = parseSchema(CASCADE_OPERATORS_SCHEMA)
      const docType = result.types.find((t) => t.name === 'Document')

      expect(docType?.fields).toHaveLength(4)
      const operators = docType?.fields.map((f) => f.operator)
      expect(operators).toContain('->')
      expect(operators).toContain('~>')
      expect(operators).toContain('<-')
      expect(operators).toContain('<~')
    })

    it('handles self-referential types', () => {
      const selfRef = {
        $id: 'test',
        Node: {
          value: 'string',
          parent: '->Node?',
          children: ['->Node'],
        },
      }

      const result = parseSchema(selfRef)
      const nodeType = result.types.find((t) => t.name === 'Node')

      const parentField = nodeType?.fields.find((f) => f.name === 'parent')
      expect(parentField?.reference).toBe('Node')

      const childrenField = nodeType?.fields.find((f) => f.name === 'children')
      expect(childrenField?.reference).toBe('Node')
      expect(childrenField?.isArray).toBe(true)
    })

    it('handles circular references between types', () => {
      const circular = {
        $id: 'test',
        User: {
          name: 'string',
          posts: ['->Post'],
        },
        Post: {
          title: 'string',
          author: '->User',
        },
      }

      const result = parseSchema(circular)

      const userType = result.types.find((t) => t.name === 'User')
      const postType = result.types.find((t) => t.name === 'Post')

      expect(userType?.fields.find((f) => f.name === 'posts')?.reference).toBe('Post')
      expect(postType?.fields.find((f) => f.name === 'author')?.reference).toBe('User')
    })
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('Module Exports', () => {
  it('DB is exported from db-factory', () => {
    expect(DB).toBeDefined()
    expect(typeof DB).toBe('function')
  })

  it('parseSchema is exported from parse-schema', () => {
    expect(parseSchema).toBeDefined()
    expect(typeof parseSchema).toBe('function')
  })

  it('types are exported from parse-schema', () => {
    // These type imports should work when implemented
    // Type assertions to verify exports exist
    const _schema: ParsedSchema = parseSchema(MINIMAL_SCHEMA)
    const _type: ParsedType = _schema.types[0]
    const _field: ParsedField = _type.fields[0]

    expect(_schema).toBeDefined()
    expect(_type).toBeDefined()
    expect(_field).toBeDefined()
  })
})
