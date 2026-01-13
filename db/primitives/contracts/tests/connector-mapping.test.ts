/**
 * ConnectorFramework Schema Mapping Tests
 *
 * TDD RED phase: Tests for integrating DataContract with ConnectorFramework
 * for source-to-destination schema mapping.
 *
 * Features tested:
 * - Source schema to contract mapping
 * - Contract to destination schema mapping
 * - Field type conversion rules
 * - Nested object flattening
 * - Array handling strategies
 *
 * @module db/primitives/contracts/tests/connector-mapping
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Schema mapping
  ContractSchemaMapper,
  createContractSchemaMapper,
  // Types
  type SchemaMapping,
  type FieldMapping,
  type MappingOptions,
  type MappingResult,
  // Type conversion
  TypeConverter,
  createTypeConverter,
  type TypeConversionRule,
  type ConversionOptions,
  // Flattening
  FlatteningStrategy,
  createFlatteningStrategy,
  type FlattenOptions,
  type ArrayHandlingStrategy,
  // Auto-mapping
  autoMapSchemas,
  type AutoMapOptions,
  type AutoMapResult,
  // Contract-aware connector
  createContractAwareConnector,
  type ContractAwareConnector,
} from '../connector-mapping'
import { type DataContract, type JSONSchema, createSchema } from '../../data-contract'

// =============================================================================
// Test Fixtures
// =============================================================================

const sourceContract: DataContract = createSchema({
  name: 'source-user',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      email: { type: 'string', format: 'email' },
      age: { type: 'integer' },
      isActive: { type: 'boolean' },
      metadata: {
        type: 'object',
        properties: {
          createdAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['id', 'email'],
  },
})

const destinationContract: DataContract = createSchema({
  name: 'dest-user',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      user_id: { type: 'string' },
      full_name: { type: 'string' },
      email_address: { type: 'string', format: 'email' },
      user_age: { type: 'number' },
      active: { type: 'boolean' },
      created_timestamp: { type: 'integer' },
      tag_list: { type: 'string' },
    },
    required: ['user_id', 'email_address'],
  },
})

// =============================================================================
// Source Schema to Contract Mapping Tests
// =============================================================================

describe('ContractSchemaMapper - Source to Contract', () => {
  describe('basic field mapping', () => {
    it('should map source fields to contract fields with explicit mappings', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
        ],
      })

      const input = { id: '123', email: 'test@example.com' }
      const output = mapper.mapToDestination(input)

      expect(output).toEqual({
        user_id: '123',
        email_address: 'test@example.com',
      })
    })

    it('should map fields by matching names when no explicit mapping exists', () => {
      const simpleSource = createSchema({
        name: 'simple-source',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
      })

      const simpleDest = createSchema({
        name: 'simple-dest',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
      })

      const mapper = createContractSchemaMapper({
        sourceContract: simpleSource,
        destinationContract: simpleDest,
      })

      const input = { id: '123', name: 'Test' }
      const output = mapper.mapToDestination(input)

      expect(output).toEqual({ id: '123', name: 'Test' })
    })

    it('should ignore source fields not in destination schema', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
        ],
      })

      const input = { id: '123', email: 'test@example.com', extraField: 'ignored' }
      const output = mapper.mapToDestination(input)

      expect(output).not.toHaveProperty('extraField')
    })
  })

  describe('computed field mapping', () => {
    it('should compute destination fields from multiple source fields', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
          {
            destination: 'full_name',
            compute: (record) => `${record.firstName} ${record.lastName}`,
          },
        ],
      })

      const input = { id: '123', firstName: 'John', lastName: 'Doe', email: 'john@test.com' }
      const output = mapper.mapToDestination(input)

      expect(output.full_name).toBe('John Doe')
    })
  })
})

// =============================================================================
// Contract to Destination Schema Mapping Tests
// =============================================================================

describe('ContractSchemaMapper - Contract to Destination', () => {
  describe('bidirectional mapping', () => {
    it('should map from destination back to source schema', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
        ],
      })

      const input = { user_id: '123', email_address: 'test@example.com' }
      const output = mapper.mapToSource(input)

      expect(output).toEqual({
        id: '123',
        email: 'test@example.com',
      })
    })

    it('should roundtrip source -> destination -> source', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
          { source: 'isActive', destination: 'active' },
        ],
      })

      const original = { id: '123', email: 'test@example.com', isActive: true }
      const dest = mapper.mapToDestination(original)
      const restored = mapper.mapToSource(dest)

      expect(restored).toEqual(original)
    })
  })

  describe('validation during mapping', () => {
    it('should validate source data against source contract', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
        ],
        validateSource: true,
      })

      // Missing required field 'email'
      const input = { id: '123' }
      const result = mapper.mapToDestinationWithValidation(input)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({ path: 'email', keyword: 'required' })
      )
    })

    it('should validate destination data against destination contract', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          // Missing email mapping - will fail destination validation
        ],
        validateDestination: true,
      })

      const input = { id: '123', email: 'test@example.com' }
      const result = mapper.mapToDestinationWithValidation(input)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({ path: 'email_address', keyword: 'required' })
      )
    })
  })
})

// =============================================================================
// Field Type Conversion Rules Tests
// =============================================================================

describe('TypeConverter - Field Type Conversion', () => {
  describe('basic type conversions', () => {
    it('should convert string to integer', () => {
      const converter = createTypeConverter()
      expect(converter.convert('42', 'string', 'integer')).toBe(42)
      expect(converter.convert('3.7', 'string', 'integer')).toBe(3)
    })

    it('should convert string to number', () => {
      const converter = createTypeConverter()
      expect(converter.convert('3.14', 'string', 'number')).toBe(3.14)
      expect(converter.convert('-100.5', 'string', 'number')).toBe(-100.5)
    })

    it('should convert string to boolean', () => {
      const converter = createTypeConverter()
      expect(converter.convert('true', 'string', 'boolean')).toBe(true)
      expect(converter.convert('false', 'string', 'boolean')).toBe(false)
      expect(converter.convert('yes', 'string', 'boolean')).toBe(true)
      expect(converter.convert('no', 'string', 'boolean')).toBe(false)
      expect(converter.convert('1', 'string', 'boolean')).toBe(true)
      expect(converter.convert('0', 'string', 'boolean')).toBe(false)
    })

    it('should convert number to string', () => {
      const converter = createTypeConverter()
      expect(converter.convert(42, 'number', 'string')).toBe('42')
      expect(converter.convert(3.14, 'number', 'string')).toBe('3.14')
    })

    it('should convert boolean to string', () => {
      const converter = createTypeConverter()
      expect(converter.convert(true, 'boolean', 'string')).toBe('true')
      expect(converter.convert(false, 'boolean', 'string')).toBe('false')
    })

    it('should convert boolean to number', () => {
      const converter = createTypeConverter()
      expect(converter.convert(true, 'boolean', 'number')).toBe(1)
      expect(converter.convert(false, 'boolean', 'number')).toBe(0)
    })
  })

  describe('date/time conversions', () => {
    it('should convert date-time string to timestamp (integer)', () => {
      const converter = createTypeConverter()
      const dateString = '2024-01-15T10:30:00Z'
      const timestamp = converter.convert(dateString, 'string', 'integer', {
        sourceFormat: 'date-time',
      })

      expect(timestamp).toBe(new Date(dateString).getTime())
    })

    it('should convert timestamp to date-time string', () => {
      const converter = createTypeConverter()
      const timestamp = 1705315800000 // 2024-01-15T10:30:00Z
      const dateString = converter.convert(timestamp, 'integer', 'string', {
        destinationFormat: 'date-time',
      })

      expect(dateString).toBe('2024-01-15T10:30:00.000Z')
    })

    it('should convert date-time to date only', () => {
      const converter = createTypeConverter()
      const dateTime = '2024-01-15T10:30:00Z'
      const date = converter.convert(dateTime, 'string', 'string', {
        sourceFormat: 'date-time',
        destinationFormat: 'date',
      })

      expect(date).toBe('2024-01-15')
    })
  })

  describe('array conversions', () => {
    it('should convert array to comma-separated string', () => {
      const converter = createTypeConverter()
      const array = ['a', 'b', 'c']
      const result = converter.convert(array, 'array', 'string')

      expect(result).toBe('a,b,c')
    })

    it('should convert comma-separated string to array', () => {
      const converter = createTypeConverter()
      const str = 'a, b, c'
      const result = converter.convert(str, 'string', 'array')

      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should convert array to JSON string', () => {
      const converter = createTypeConverter()
      const array = [1, 2, 3]
      const result = converter.convert(array, 'array', 'string', { asJson: true })

      expect(result).toBe('[1,2,3]')
    })
  })

  describe('custom conversion rules', () => {
    it('should use custom conversion rules', () => {
      const converter = createTypeConverter({
        customRules: [
          {
            from: 'string',
            to: 'string',
            sourceFormat: 'email',
            convert: (value) => (value as string).toLowerCase(),
          },
        ],
      })

      expect(converter.convert('TEST@EXAMPLE.COM', 'string', 'string', {
        sourceFormat: 'email',
      })).toBe('test@example.com')
    })
  })

  describe('null handling', () => {
    it('should preserve null values by default', () => {
      const converter = createTypeConverter()
      expect(converter.convert(null, 'string', 'integer')).toBe(null)
    })

    it('should convert null to default value when specified', () => {
      const converter = createTypeConverter()
      expect(converter.convert(null, 'string', 'integer', {
        nullDefault: 0,
      })).toBe(0)
    })
  })

  describe('integration with schema mapper', () => {
    it('should auto-convert types based on schema definitions', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
          { source: 'age', destination: 'user_age' }, // integer -> number
          { source: 'metadata.createdAt', destination: 'created_timestamp' }, // date-time -> integer
          { source: 'metadata.tags', destination: 'tag_list' }, // array -> string
        ],
        autoConvertTypes: true,
      })

      const input = {
        id: '123',
        email: 'test@example.com',
        age: 30,
        metadata: {
          createdAt: '2024-01-15T10:30:00Z',
          tags: ['vip', 'active'],
        },
      }

      const output = mapper.mapToDestination(input)

      expect(output.user_age).toBe(30) // still number
      expect(typeof output.created_timestamp).toBe('number')
      expect(output.tag_list).toBe('vip,active')
    })
  })
})

// =============================================================================
// Nested Object Flattening Tests
// =============================================================================

describe('FlatteningStrategy - Nested Object Handling', () => {
  describe('basic flattening', () => {
    it('should flatten nested objects with underscore separator', () => {
      const strategy = createFlatteningStrategy({ separator: '_' })
      const input = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: '10001',
          },
        },
      }

      const output = strategy.flatten(input)

      expect(output).toEqual({
        user_name: 'John',
        user_address_city: 'NYC',
        user_address_zip: '10001',
      })
    })

    it('should flatten with dot separator', () => {
      const strategy = createFlatteningStrategy({ separator: '.' })
      const input = { user: { name: 'John' } }

      const output = strategy.flatten(input)

      expect(output).toEqual({ 'user.name': 'John' })
    })

    it('should respect max depth setting', () => {
      const strategy = createFlatteningStrategy({ separator: '_', maxDepth: 1 })
      const input = {
        user: {
          profile: {
            name: 'John',
          },
        },
      }

      const output = strategy.flatten(input)

      expect(output).toEqual({
        user: { profile: { name: 'John' } },
      })
    })
  })

  describe('unflattening', () => {
    it('should unflatten to nested objects', () => {
      const strategy = createFlatteningStrategy({ separator: '_' })
      const input = {
        user_name: 'John',
        user_address_city: 'NYC',
      }

      const output = strategy.unflatten(input)

      expect(output).toEqual({
        user: {
          name: 'John',
          address: {
            city: 'NYC',
          },
        },
      })
    })

    it('should roundtrip flatten/unflatten', () => {
      const strategy = createFlatteningStrategy({ separator: '_' })
      const original = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: '10001',
          },
        },
      }

      const flattened = strategy.flatten(original)
      const restored = strategy.unflatten(flattened)

      expect(restored).toEqual(original)
    })
  })

  describe('selective flattening', () => {
    it('should only flatten specified paths', () => {
      const strategy = createFlatteningStrategy({
        separator: '_',
        includePaths: ['user.address'],
      })

      const input = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
          },
        },
      }

      const output = strategy.flatten(input)

      expect(output).toEqual({
        user: { name: 'John' },
        user_address_city: 'NYC',
      })
    })

    it('should exclude specified paths from flattening', () => {
      const strategy = createFlatteningStrategy({
        separator: '_',
        excludePaths: ['metadata'],
      })

      const input = {
        user: { name: 'John' },
        metadata: { tags: ['a', 'b'] },
      }

      const output = strategy.flatten(input)

      expect(output).toEqual({
        user_name: 'John',
        metadata: { tags: ['a', 'b'] },
      })
    })
  })

  describe('integration with schema mapper', () => {
    it('should flatten source before mapping', () => {
      const mapper = createContractSchemaMapper({
        sourceContract,
        destinationContract,
        fieldMappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
          { source: 'metadata_createdAt', destination: 'created_timestamp' },
        ],
        flattenSource: {
          enabled: true,
          separator: '_',
        },
        autoConvertTypes: true,
      })

      const input = {
        id: '123',
        email: 'test@example.com',
        metadata: {
          createdAt: '2024-01-15T10:30:00Z',
        },
      }

      const output = mapper.mapToDestination(input)

      expect(output.user_id).toBe('123')
      expect(typeof output.created_timestamp).toBe('number')
    })
  })
})

// =============================================================================
// Array Handling Strategies Tests
// =============================================================================

describe('ArrayHandlingStrategy - Array Handling', () => {
  describe('array to string conversion', () => {
    it('should join array elements with comma', () => {
      const strategy = createFlatteningStrategy({
        arrayHandling: 'join',
        joinSeparator: ',',
      })

      const input = { tags: ['a', 'b', 'c'] }
      const output = strategy.flatten(input)

      expect(output.tags).toBe('a,b,c')
    })

    it('should join with custom separator', () => {
      const strategy = createFlatteningStrategy({
        arrayHandling: 'join',
        joinSeparator: ' | ',
      })

      const input = { tags: ['a', 'b', 'c'] }
      const output = strategy.flatten(input)

      expect(output.tags).toBe('a | b | c')
    })
  })

  describe('array to JSON string', () => {
    it('should convert array to JSON string', () => {
      const strategy = createFlatteningStrategy({
        arrayHandling: 'json',
      })

      const input = { tags: ['a', 'b', 'c'] }
      const output = strategy.flatten(input)

      expect(output.tags).toBe('["a","b","c"]')
    })

    it('should convert nested objects in arrays to JSON', () => {
      const strategy = createFlatteningStrategy({
        arrayHandling: 'json',
      })

      const input = { items: [{ id: 1 }, { id: 2 }] }
      const output = strategy.flatten(input)

      expect(output.items).toBe('[{"id":1},{"id":2}]')
    })
  })

  describe('array flattening (index-based)', () => {
    it('should flatten array with indices', () => {
      const strategy = createFlatteningStrategy({
        separator: '_',
        arrayHandling: 'index',
      })

      const input = { tags: ['a', 'b', 'c'] }
      const output = strategy.flatten(input)

      expect(output).toEqual({
        tags_0: 'a',
        tags_1: 'b',
        tags_2: 'c',
      })
    })

    it('should flatten nested objects in arrays', () => {
      const strategy = createFlatteningStrategy({
        separator: '_',
        arrayHandling: 'index',
      })

      const input = {
        users: [
          { name: 'John', age: 30 },
          { name: 'Jane', age: 25 },
        ],
      }

      const output = strategy.flatten(input)

      expect(output).toEqual({
        users_0_name: 'John',
        users_0_age: 30,
        users_1_name: 'Jane',
        users_1_age: 25,
      })
    })
  })

  describe('array preservation', () => {
    it('should preserve arrays when handling is "preserve"', () => {
      const strategy = createFlatteningStrategy({
        separator: '_',
        arrayHandling: 'preserve',
      })

      const input = {
        user: { tags: ['a', 'b'] },
      }

      const output = strategy.flatten(input)

      expect(output).toEqual({
        user_tags: ['a', 'b'],
      })
    })
  })

  describe('first element extraction', () => {
    it('should extract first element when handling is "first"', () => {
      const strategy = createFlatteningStrategy({
        arrayHandling: 'first',
      })

      const input = { tags: ['primary', 'secondary'] }
      const output = strategy.flatten(input)

      expect(output.tags).toBe('primary')
    })

    it('should handle empty arrays gracefully', () => {
      const strategy = createFlatteningStrategy({
        arrayHandling: 'first',
      })

      const input = { tags: [] }
      const output = strategy.flatten(input)

      expect(output.tags).toBe(null)
    })
  })
})

// =============================================================================
// Auto-Mapping Tests
// =============================================================================

describe('Auto-Mapping - Schema Inference', () => {
  describe('autoMapSchemas', () => {
    it('should auto-map fields with matching names', () => {
      const result = autoMapSchemas(sourceContract, destinationContract)

      // Should not find direct matches due to different naming conventions
      expect(result.unmappedSource).toContain('id')
      expect(result.unmappedDestination).toContain('user_id')
    })

    it('should suggest mappings based on name similarity', () => {
      const result = autoMapSchemas(sourceContract, destinationContract, {
        useSimilarity: true,
        similarityThreshold: 0.5,
      })

      // Should suggest id -> user_id based on "id" substring match
      expect(result.suggestedMappings).toContainEqual(
        expect.objectContaining({
          source: 'id',
          destination: 'user_id',
        })
      )
    })

    it('should detect type-compatible mappings', () => {
      const result = autoMapSchemas(sourceContract, destinationContract, {
        checkTypeCompatibility: true,
      })

      // isActive (boolean) -> active (boolean) should be compatible
      expect(result.suggestedMappings).toContainEqual(
        expect.objectContaining({
          source: 'isActive',
          destination: 'active',
          typeCompatible: true,
        })
      )
    })

    it('should flag incompatible type mappings', () => {
      const result = autoMapSchemas(sourceContract, destinationContract, {
        checkTypeCompatibility: true,
      })

      // age (integer) -> user_age (number) should have conversion needed
      const ageMapping = result.suggestedMappings.find(
        (m) => m.source === 'age' && m.destination === 'user_age'
      )

      if (ageMapping) {
        expect(ageMapping.conversionNeeded).toBe(false) // integer is compatible with number
      }
    })
  })
})

// =============================================================================
// Contract-Aware Connector Tests
// =============================================================================

describe('ContractAwareConnector', () => {
  it('should create a connector with source and destination contracts', () => {
    const connector = createContractAwareConnector({
      sourceContract,
      destinationContract,
      fieldMappings: [
        { source: 'id', destination: 'user_id' },
        { source: 'email', destination: 'email_address' },
      ],
    })

    expect(connector.sourceContract).toBe(sourceContract)
    expect(connector.destinationContract).toBe(destinationContract)
  })

  it('should transform records using the mapping', async () => {
    const connector = createContractAwareConnector({
      sourceContract,
      destinationContract,
      fieldMappings: [
        { source: 'id', destination: 'user_id' },
        { source: 'email', destination: 'email_address' },
      ],
    })

    const input = { id: '123', email: 'test@example.com' }
    const output = await connector.transform(input)

    expect(output).toEqual({
      user_id: '123',
      email_address: 'test@example.com',
    })
  })

  it('should validate input against source contract', async () => {
    const connector = createContractAwareConnector({
      sourceContract,
      destinationContract,
      fieldMappings: [
        { source: 'id', destination: 'user_id' },
        { source: 'email', destination: 'email_address' },
      ],
      validateOnTransform: true,
    })

    // Missing required field
    const input = { id: '123' }

    await expect(connector.transform(input)).rejects.toThrow(/validation/i)
  })

  it('should validate output against destination contract', async () => {
    const connector = createContractAwareConnector({
      sourceContract,
      destinationContract,
      fieldMappings: [
        { source: 'id', destination: 'user_id' },
        // Missing email mapping
      ],
      validateOnTransform: true,
    })

    const input = { id: '123', email: 'test@example.com' }

    await expect(connector.transform(input)).rejects.toThrow(/validation/i)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration - Full Pipeline', () => {
  it('should handle complete ETL scenario with contracts', () => {
    // Legacy CRM source
    const crmContract = createSchema({
      name: 'crm-customer',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          CUST_ID: { type: 'string' },
          CUST_NAME: { type: 'string' },
          CUST_EMAIL: { type: 'string' },
          CREATED_DT: { type: 'string', format: 'date-time' },
          IS_ACTIVE: { type: 'string' },
          TAGS: { type: 'array', items: { type: 'string' } },
          ADDRESS: {
            type: 'object',
            properties: {
              STREET: { type: 'string' },
              CITY: { type: 'string' },
              ZIP: { type: 'string' },
            },
          },
        },
        required: ['CUST_ID', 'CUST_EMAIL'],
      },
    })

    // Modern warehouse destination
    const warehouseContract = createSchema({
      name: 'warehouse-customer',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          customer_name: { type: 'string' },
          email: { type: 'string' },
          created_timestamp: { type: 'integer' },
          is_active: { type: 'boolean' },
          tags_csv: { type: 'string' },
          address_street: { type: 'string' },
          address_city: { type: 'string' },
          address_zip: { type: 'string' },
        },
        required: ['customer_id', 'email'],
      },
    })

    const mapper = createContractSchemaMapper({
      sourceContract: crmContract,
      destinationContract: warehouseContract,
      fieldMappings: [
        { source: 'CUST_ID', destination: 'customer_id' },
        { source: 'CUST_NAME', destination: 'customer_name' },
        { source: 'CUST_EMAIL', destination: 'email' },
        { source: 'CREATED_DT', destination: 'created_timestamp' },
        { source: 'IS_ACTIVE', destination: 'is_active' },
        { source: 'TAGS', destination: 'tags_csv' },
        { source: 'ADDRESS.STREET', destination: 'address_street' },
        { source: 'ADDRESS.CITY', destination: 'address_city' },
        { source: 'ADDRESS.ZIP', destination: 'address_zip' },
      ],
      autoConvertTypes: true,
      flattenSource: {
        enabled: true,
        separator: '.',
      },
    })

    const legacyRecord = {
      CUST_ID: 'C123',
      CUST_NAME: 'Acme Corp',
      CUST_EMAIL: 'contact@acme.com',
      CREATED_DT: '2024-01-15T10:30:00Z',
      IS_ACTIVE: 'Y',
      TAGS: ['vip', 'enterprise'],
      ADDRESS: {
        STREET: '123 Main St',
        CITY: 'NYC',
        ZIP: '10001',
      },
    }

    const warehouseRecord = mapper.mapToDestination(legacyRecord)

    expect(warehouseRecord).toEqual({
      customer_id: 'C123',
      customer_name: 'Acme Corp',
      email: 'contact@acme.com',
      created_timestamp: expect.any(Number),
      is_active: true,
      tags_csv: 'vip,enterprise',
      address_street: '123 Main St',
      address_city: 'NYC',
      address_zip: '10001',
    })
  })

  it('should handle batch transformation with validation', async () => {
    const connector = createContractAwareConnector({
      sourceContract,
      destinationContract,
      fieldMappings: [
        { source: 'id', destination: 'user_id' },
        { source: 'email', destination: 'email_address' },
        { source: 'isActive', destination: 'active' },
      ],
      validateOnTransform: true,
    })

    const records = [
      { id: '1', email: 'a@test.com', isActive: true },
      { id: '2', email: 'b@test.com', isActive: false },
      { id: '3' }, // Invalid - missing email
    ]

    const results = await connector.transformBatch(records)

    expect(results.successful).toHaveLength(2)
    expect(results.failed).toHaveLength(1)
    expect(results.failed[0].record).toEqual(records[2])
    expect(results.failed[0].errors).toContainEqual(
      expect.objectContaining({ path: 'email' })
    )
  })
})
