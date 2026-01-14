/**
 * Tests for Schema Inference module
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SchemaInferrer,
  createInferrer,
  inferSchema,
  inferSchemaFromStream,
  inferSchemaWithStats,
  mergeSchemas,
  parseCSVForInference,
  inferSchemaFromCSV,
  parseJSONLForInference,
  inferSchemaFromJSONL,
  type InferenceOptions,
  type StringPattern,
} from '../inference'

describe('SchemaInferrer', () => {
  let inferrer: SchemaInferrer

  beforeEach(() => {
    inferrer = new SchemaInferrer()
  })

  describe('basic type inference', () => {
    it('should infer string type', () => {
      const samples = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]
      const contract = inferrer.infer(samples)

      expect(contract.schema.type).toBe('object')
      expect(contract.schema.properties?.name).toEqual({ type: 'string' })
      expect(contract.schema.required).toContain('name')
    })

    it('should infer number type', () => {
      const samples = [{ price: 19.99 }, { price: 29.99 }, { price: 9.99 }]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.price.type).toBe('number')
    })

    it('should infer integer type', () => {
      const samples = [{ count: 1 }, { count: 2 }, { count: 3 }]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.count.type).toBe('integer')
    })

    it('should infer boolean type', () => {
      const samples = [{ active: true }, { active: false }, { active: true }]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.active.type).toBe('boolean')
    })

    it('should infer null type', () => {
      const samples = [{ value: null }, { value: null }, { value: null }]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.value.type).toBe('null')
    })

    it('should infer mixed number/integer as number', () => {
      const samples = [{ value: 1 }, { value: 2.5 }, { value: 3 }]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.value.type).toBe('number')
    })
  })

  describe('nullability inference', () => {
    it('should mark field as nullable when null values exceed threshold', () => {
      const inferrer = new SchemaInferrer({ nullableThreshold: 0.05 })
      const samples = [
        { name: 'Alice' },
        { name: null },
        { name: 'Bob' },
        { name: null },
        { name: 'Charlie' },
        { name: null }, // 3/6 = 50% nulls
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.name.type).toEqual(['string', 'null'])
    })

    it('should mark field as required when consistently present and non-null', () => {
      const samples = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.required).toContain('id')
      expect(contract.schema.required).toContain('name')
    })

    it('should not mark field as required when sometimes missing', () => {
      const samples = [
        { id: 1, name: 'Alice', email: 'alice@test.com' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie', email: 'charlie@test.com' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.required).toContain('id')
      expect(contract.schema.required).toContain('name')
      expect(contract.schema.required).not.toContain('email')
    })
  })

  describe('pattern detection', () => {
    it('should detect email pattern', () => {
      const samples = [
        { email: 'alice@example.com' },
        { email: 'bob@test.org' },
        { email: 'charlie@domain.io' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.email.format).toBe('email')
    })

    it('should detect URL pattern', () => {
      const samples = [
        { website: 'https://example.com' },
        { website: 'http://test.org/page' },
        { website: 'https://domain.io/path/to/resource' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.website.format).toBe('uri')
    })

    it('should detect UUID pattern', () => {
      const samples = [
        { id: '550e8400-e29b-41d4-a716-446655440000' },
        { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
        { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.id.format).toBe('uuid')
    })

    it('should detect ISO date pattern', () => {
      const samples = [
        { date: '2024-01-15' },
        { date: '2024-02-20' },
        { date: '2024-03-25' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.date.format).toBe('date')
    })

    it('should detect ISO datetime pattern', () => {
      const samples = [
        { timestamp: '2024-01-15T10:30:00Z' },
        { timestamp: '2024-02-20T14:45:30.123Z' },
        { timestamp: '2024-03-25T08:00:00+05:00' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.timestamp.format).toBe('date-time')
    })

    it('should detect IPv4 pattern', () => {
      const samples = [
        { ip: '192.168.1.1' },
        { ip: '10.0.0.1' },
        { ip: '172.16.0.100' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.ip.format).toBe('ipv4')
    })

    it('should not detect pattern when values are inconsistent', () => {
      const samples = [
        { value: 'alice@example.com' },
        { value: 'not-an-email' },
        { value: 'https://example.com' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.value.format).toBeUndefined()
    })

    it('should disable pattern detection when option is false', () => {
      const inferrer = new SchemaInferrer({ detectPatterns: false })
      const samples = [
        { email: 'alice@example.com' },
        { email: 'bob@test.org' },
        { email: 'charlie@domain.io' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.email.format).toBeUndefined()
    })
  })

  describe('enum inference', () => {
    it('should infer enum for low-cardinality strings', () => {
      const inferrer = new SchemaInferrer({
        enumThreshold: 10,
        enumCardinalityThreshold: 0.5,
      })
      const samples = Array.from({ length: 100 }, (_, i) => ({
        status: ['pending', 'approved', 'rejected'][i % 3],
      }))
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.status.enum).toBeDefined()
      expect(contract.schema.properties?.status.enum).toContain('pending')
      expect(contract.schema.properties?.status.enum).toContain('approved')
      expect(contract.schema.properties?.status.enum).toContain('rejected')
    })

    it('should not infer enum when cardinality is too high', () => {
      const inferrer = new SchemaInferrer({
        enumThreshold: 5,
        enumCardinalityThreshold: 0.1,
      })
      const samples = Array.from({ length: 10 }, (_, i) => ({
        name: `user_${i}`,
      }))
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.name.enum).toBeUndefined()
    })

    it('should not infer enum when unique values exceed threshold', () => {
      const inferrer = new SchemaInferrer({
        enumThreshold: 3,
        enumCardinalityThreshold: 1.0,
      })
      const samples = [
        { category: 'A' },
        { category: 'B' },
        { category: 'C' },
        { category: 'D' },
        { category: 'E' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.category.enum).toBeUndefined()
    })
  })

  describe('nested object inference', () => {
    it('should infer nested object structure', () => {
      const samples = [
        { user: { name: 'Alice', age: 30 } },
        { user: { name: 'Bob', age: 25 } },
        { user: { name: 'Charlie', age: 35 } },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.user.type).toBe('object')
      expect(contract.schema.properties?.user.properties?.name.type).toBe('string')
      expect(contract.schema.properties?.user.properties?.age.type).toBe('integer')
    })

    it('should handle deeply nested structures', () => {
      const samples = [
        { data: { level1: { level2: { value: 'deep' } } } },
        { data: { level1: { level2: { value: 'nested' } } } },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.data.properties?.level1.properties?.level2.properties?.value.type).toBe('string')
    })

    it('should handle objects with varying properties', () => {
      const samples = [
        { config: { timeout: 30, retries: 3 } },
        { config: { timeout: 60 } },
        { config: { timeout: 45, debug: true } },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.config.properties?.timeout.type).toBe('integer')
      expect(contract.schema.properties?.config.required).toContain('timeout')
      expect(contract.schema.properties?.config.required).not.toContain('retries')
      expect(contract.schema.properties?.config.required).not.toContain('debug')
    })
  })

  describe('array inference', () => {
    it('should infer array with primitive items', () => {
      const samples = [
        { tags: ['javascript', 'typescript'] },
        { tags: ['python', 'rust'] },
        { tags: ['go', 'java'] },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.tags.type).toBe('array')
      expect(contract.schema.properties?.tags.items?.type).toBe('string')
    })

    it('should infer array with object items', () => {
      const samples = [
        { items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }] },
        { items: [{ id: 3, name: 'Item 3' }] },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.items.type).toBe('array')
      expect(contract.schema.properties?.items.items?.type).toBe('object')
      expect(contract.schema.properties?.items.items?.properties?.id.type).toBe('integer')
      expect(contract.schema.properties?.items.items?.properties?.name.type).toBe('string')
    })

    it('should infer array with mixed number types', () => {
      const samples = [
        { values: [1, 2.5, 3] },
        { values: [4, 5.5] },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.values.items?.type).toBe('number')
    })

    it('should handle empty arrays', () => {
      const samples = [
        { items: [] },
        { items: [] },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.items.type).toBe('array')
    })
  })

  describe('numeric range inference', () => {
    it('should infer numeric ranges when enabled', () => {
      const inferrer = new SchemaInferrer({ inferRanges: true })
      const samples = [
        { score: 10 },
        { score: 50 },
        { score: 100 },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.score.minimum).toBe(10)
      expect(contract.schema.properties?.score.maximum).toBe(100)
    })

    it('should not infer ranges when disabled', () => {
      const inferrer = new SchemaInferrer({ inferRanges: false })
      const samples = [
        { score: 10 },
        { score: 50 },
        { score: 100 },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.score.minimum).toBeUndefined()
      expect(contract.schema.properties?.score.maximum).toBeUndefined()
    })
  })

  describe('string length inference', () => {
    it('should infer string length constraints when enabled', () => {
      const inferrer = new SchemaInferrer({ inferLengthConstraints: true })
      const samples = [
        { code: 'ABC' },
        { code: 'DEFGH' },
        { code: 'IJ' },
      ]
      const contract = inferrer.infer(samples)

      expect(contract.schema.properties?.code.minLength).toBe(2)
      expect(contract.schema.properties?.code.maxLength).toBe(5)
    })
  })

  describe('stream inference', () => {
    it('should infer schema from async iterable', async () => {
      async function* generateSamples() {
        yield { name: 'Alice', age: 30 }
        yield { name: 'Bob', age: 25 }
        yield { name: 'Charlie', age: 35 }
      }

      const contract = await inferrer.inferStream(generateSamples())

      expect(contract.schema.properties?.name.type).toBe('string')
      expect(contract.schema.properties?.age.type).toBe('integer')
    })

    it('should handle large streams efficiently', async () => {
      async function* generateLargeStream() {
        for (let i = 0; i < 1000; i++) {
          yield { id: i, value: `item_${i}` }
        }
      }

      const contract = await inferrer.inferStream(generateLargeStream())

      expect(contract.schema.properties?.id.type).toBe('integer')
      expect(contract.schema.properties?.value.type).toBe('string')
    })
  })

  describe('schema merging', () => {
    it('should merge schemas with same structure', () => {
      const schema1 = inferrer.infer([{ name: 'Alice', age: 30 }])
      const schema2 = inferrer.infer([{ name: 'Bob', age: 25 }])

      const merged = inferrer.merge([schema1, schema2])

      expect(merged.schema.properties?.name.type).toBe('string')
      expect(merged.schema.properties?.age.type).toBe('integer')
    })

    it('should merge schemas with different properties', () => {
      const schema1 = inferrer.infer([{ name: 'Alice', age: 30 }])
      const schema2 = inferrer.infer([{ name: 'Bob', email: 'bob@test.com' }])

      const merged = inferrer.merge([schema1, schema2])

      expect(merged.schema.properties?.name.type).toBe('string')
      expect(merged.schema.properties?.age).toBeDefined()
      expect(merged.schema.properties?.email).toBeDefined()
    })

    it('should only require fields present in all schemas', () => {
      const schema1 = inferrer.infer([{ id: 1, name: 'Alice' }])
      const schema2 = inferrer.infer([{ id: 2, email: 'bob@test.com' }])

      const merged = inferrer.merge([schema1, schema2])

      expect(merged.schema.required).toContain('id')
      expect(merged.schema.required).not.toContain('name')
      expect(merged.schema.required).not.toContain('email')
    })

    it('should return empty schema for empty array', () => {
      const merged = inferrer.merge([])
      expect(merged.schema.type).toBe('object')
    })

    it('should return same schema for single item array', () => {
      const schema = inferrer.infer([{ name: 'Alice' }])
      const merged = inferrer.merge([schema])

      expect(merged.schema).toEqual(schema.schema)
    })
  })

  describe('inference with statistics', () => {
    it('should return inference statistics', () => {
      const result = inferrer.inferWithStats([
        { id: '550e8400-e29b-41d4-a716-446655440000', count: 10 },
        { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', count: 20 },
        { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', count: 15 },
      ])

      expect(result.statistics.totalSamples).toBe(3)
      expect(result.statistics.fieldsInferred).toBeGreaterThan(0)
      expect(result.statistics.patternsDetected).toBe(1) // UUID
    })
  })

  describe('pattern detection methods', () => {
    it('detectStringPattern should detect email pattern', () => {
      const pattern = inferrer.detectStringPattern([
        'alice@example.com',
        'bob@test.org',
        'charlie@domain.io',
      ])

      expect(pattern).toEqual({ type: 'email' })
    })

    it('detectStringPattern should return null for mixed patterns', () => {
      const pattern = inferrer.detectStringPattern([
        'alice@example.com',
        'not-an-email',
        '12345',
      ])

      expect(pattern).toBeNull()
    })

    it('detectNumericRange should detect constraints', () => {
      const constraints = inferrer.detectNumericRange([1, 5, 10, 15, 20])

      expect(constraints.minimum).toBe(1)
      expect(constraints.maximum).toBe(20)
      expect(constraints.isInteger).toBe(true)
      expect(constraints.isPositive).toBe(true)
    })

    it('detectNumericRange should handle negative numbers', () => {
      const constraints = inferrer.detectNumericRange([-10, -5, 0, 5, 10])

      expect(constraints.minimum).toBe(-10)
      expect(constraints.maximum).toBe(10)
      expect(constraints.isPositive).toBe(false)
      expect(constraints.isNonNegative).toBe(false)
    })

    it('detectNumericRange should handle floats', () => {
      const constraints = inferrer.detectNumericRange([1.5, 2.5, 3.5])

      expect(constraints.isInteger).toBe(false)
    })
  })
})

describe('Factory Functions', () => {
  describe('createInferrer', () => {
    it('should create inferrer with default options', () => {
      const inferrer = createInferrer()
      expect(inferrer).toBeInstanceOf(SchemaInferrer)
    })

    it('should create inferrer with custom options', () => {
      const inferrer = createInferrer({
        contractName: 'CustomSchema',
        enumThreshold: 5,
      })
      const contract = inferrer.infer([{ status: 'a' }])
      expect(contract.name).toBe('CustomSchema')
    })
  })

  describe('inferSchema', () => {
    it('should infer schema from samples', () => {
      const contract = inferSchema([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])

      expect(contract.schema.properties?.name.type).toBe('string')
      expect(contract.schema.properties?.age.type).toBe('integer')
    })

    it('should accept custom options', () => {
      const contract = inferSchema(
        [{ email: 'test@example.com' }],
        { detectPatterns: false }
      )

      expect(contract.schema.properties?.email.format).toBeUndefined()
    })
  })

  describe('inferSchemaFromStream', () => {
    it('should infer schema from async stream', async () => {
      async function* samples() {
        yield { x: 1 }
        yield { x: 2 }
      }

      const contract = await inferSchemaFromStream(samples())
      expect(contract.schema.properties?.x.type).toBe('integer')
    })
  })

  describe('inferSchemaWithStats', () => {
    it('should return contract and statistics', () => {
      const result = inferSchemaWithStats([
        { name: 'Alice' },
        { name: 'Bob' },
      ])

      expect(result.contract).toBeDefined()
      expect(result.statistics.totalSamples).toBe(2)
    })
  })

  describe('mergeSchemas', () => {
    it('should merge multiple schemas', () => {
      const schema1 = inferSchema([{ a: 1 }])
      const schema2 = inferSchema([{ b: 2 }])

      const merged = mergeSchemas([schema1, schema2])

      expect(merged.schema.properties?.a).toBeDefined()
      expect(merged.schema.properties?.b).toBeDefined()
    })
  })
})

describe('CSV Inference', () => {
  describe('parseCSVForInference', () => {
    it('should parse CSV with headers', () => {
      const csv = `name,age,active
Alice,30,true
Bob,25,false
Charlie,35,true`

      const samples = parseCSVForInference(csv)

      expect(samples).toHaveLength(3)
      expect(samples[0]).toEqual({ name: 'Alice', age: 30, active: true })
      expect(samples[1]).toEqual({ name: 'Bob', age: 25, active: false })
    })

    it('should parse CSV without headers', () => {
      const csv = `Alice,30
Bob,25`

      const samples = parseCSVForInference(csv, {
        hasHeaders: false,
        columnNames: ['name', 'age'],
      })

      expect(samples).toHaveLength(2)
      expect(samples[0]).toEqual({ name: 'Alice', age: 30 })
    })

    it('should auto-generate column names', () => {
      const csv = `Alice,30
Bob,25`

      const samples = parseCSVForInference(csv, { hasHeaders: false })

      expect(samples[0]).toHaveProperty('column_1')
      expect(samples[0]).toHaveProperty('column_2')
    })

    it('should handle quoted fields', () => {
      const csv = `name,description
Alice,"Hello, World"
Bob,"Line 1""Line 2"`

      const samples = parseCSVForInference(csv)

      expect(samples[0]).toEqual({ name: 'Alice', description: 'Hello, World' })
      expect(samples[1]).toEqual({ name: 'Bob', description: 'Line 1"Line 2' })
    })

    it('should handle custom delimiter', () => {
      const csv = `name;age
Alice;30
Bob;25`

      const samples = parseCSVForInference(csv, { delimiter: ';' })

      expect(samples[0]).toEqual({ name: 'Alice', age: 30 })
    })

    it('should convert null strings to null', () => {
      const csv = `name,value
Alice,null
Bob,`

      const samples = parseCSVForInference(csv, { treatEmptyAsNull: true })

      expect(samples[0]).toEqual({ name: 'Alice', value: null })
      expect(samples[1]).toEqual({ name: 'Bob', value: null })
    })

    it('should respect maxRows option', () => {
      const csv = `name
Alice
Bob
Charlie
David`

      const samples = parseCSVForInference(csv, { maxRows: 2 })

      expect(samples).toHaveLength(2)
    })
  })

  describe('inferSchemaFromCSV', () => {
    it('should infer schema from CSV content', () => {
      const csv = `id,name,age,email
1,Alice,30,alice@test.com
2,Bob,25,bob@test.com
3,Charlie,35,charlie@test.com`

      const contract = inferSchemaFromCSV(csv)

      expect(contract.schema.properties?.id.type).toBe('integer')
      expect(contract.schema.properties?.name.type).toBe('string')
      expect(contract.schema.properties?.age.type).toBe('integer')
      expect(contract.schema.properties?.email.format).toBe('email')
    })
  })
})

describe('JSONL Inference', () => {
  describe('parseJSONLForInference', () => {
    it('should parse JSONL content', () => {
      const jsonl = `{"name": "Alice", "age": 30}
{"name": "Bob", "age": 25}
{"name": "Charlie", "age": 35}`

      const samples = parseJSONLForInference(jsonl)

      expect(samples).toHaveLength(3)
      expect(samples[0]).toEqual({ name: 'Alice', age: 30 })
    })

    it('should skip invalid JSON lines', () => {
      const jsonl = `{"name": "Alice"}
invalid json
{"name": "Bob"}`

      const samples = parseJSONLForInference(jsonl)

      expect(samples).toHaveLength(2)
    })

    it('should respect maxRows option', () => {
      const jsonl = `{"x": 1}
{"x": 2}
{"x": 3}
{"x": 4}`

      const samples = parseJSONLForInference(jsonl, 2)

      expect(samples).toHaveLength(2)
    })

    it('should handle empty lines', () => {
      const jsonl = `{"x": 1}

{"x": 2}`

      const samples = parseJSONLForInference(jsonl)

      expect(samples).toHaveLength(2)
    })
  })

  describe('inferSchemaFromJSONL', () => {
    it('should infer schema from JSONL content', () => {
      const jsonl = `{"id": "550e8400-e29b-41d4-a716-446655440000", "count": 10}
{"id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "count": 20}
{"id": "f47ac10b-58cc-4372-a567-0e02b2c3d479", "count": 30}`

      const contract = inferSchemaFromJSONL(jsonl)

      expect(contract.schema.properties?.id.format).toBe('uuid')
      expect(contract.schema.properties?.count.type).toBe('integer')
    })
  })
})

describe('Edge Cases', () => {
  it('should handle empty samples array', () => {
    const inferrer = new SchemaInferrer()
    const contract = inferrer.infer([])

    expect(contract.schema.type).toBe('null')
  })

  it('should handle samples with no consistent structure', () => {
    const inferrer = new SchemaInferrer({ typeStrategy: 'loose' })
    const samples = [
      { a: 1 },
      { b: 'string' },
      { c: true },
    ]
    const contract = inferrer.infer(samples)

    // Should have all properties
    expect(contract.schema.properties?.a).toBeDefined()
    expect(contract.schema.properties?.b).toBeDefined()
    expect(contract.schema.properties?.c).toBeDefined()
  })

  it('should handle very large string values', () => {
    const longString = 'a'.repeat(10000)
    const inferrer = new SchemaInferrer({ inferLengthConstraints: true })
    const contract = inferrer.infer([{ text: longString }])

    expect(contract.schema.properties?.text.maxLength).toBe(10000)
  })

  it('should handle circular-like structures', () => {
    // Note: actual circular references would cause issues,
    // but similar-looking nested structures should work
    const samples = [
      { level1: { level2: { level3: { value: 1 } } } },
      { level1: { level2: { level3: { value: 2 } } } },
    ]
    const inferrer = new SchemaInferrer()
    const contract = inferrer.infer(samples)

    expect(contract.schema.properties?.level1.properties?.level2.properties?.level3.properties?.value.type).toBe('integer')
  })

  it('should handle arrays of arrays', () => {
    const samples = [
      { matrix: [[1, 2], [3, 4]] },
      { matrix: [[5, 6], [7, 8]] },
    ]
    const inferrer = new SchemaInferrer()
    const contract = inferrer.infer(samples)

    expect(contract.schema.properties?.matrix.type).toBe('array')
    expect(contract.schema.properties?.matrix.items?.type).toBe('array')
    expect(contract.schema.properties?.matrix.items?.items?.type).toBe('integer')
  })
})

describe('Contract Metadata', () => {
  it('should set custom contract name', () => {
    const contract = inferSchema([{ x: 1 }], { contractName: 'MyContract' })
    expect(contract.name).toBe('MyContract')
  })

  it('should set custom contract version', () => {
    const contract = inferSchema([{ x: 1 }], { contractVersion: '2.0.0' })
    expect(contract.version).toBe('2.0.0')
  })

  it('should include metadata', () => {
    const contract = inferSchema([{ x: 1 }], {
      metadata: {
        description: 'Test schema',
        owner: 'test-team',
        tags: ['test', 'inferred'],
      },
    })

    expect(contract.metadata?.description).toBe('Test schema')
    expect(contract.metadata?.owner).toBe('test-team')
    expect(contract.metadata?.tags).toContain('test')
  })
})
