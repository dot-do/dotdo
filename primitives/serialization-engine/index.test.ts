import { describe, it, expect } from 'vitest'
import {
  SerializationEngine,
  JSONSerializer,
  MsgPackSerializer,
  CBORSerializer,
  TypedSerializer,
  StreamSerializer,
  CompressionAdapter,
} from './index'
import type { SerializationFormat, CustomSerializer, Schema } from './types'

describe('SerializationEngine', () => {
  describe('JSON Serialization', () => {
    it('should serialize and deserialize simple objects', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test', count: 42, active: true }

      const serialized = engine.serialize(data, 'json')
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized).toEqual(data)
    })

    it('should serialize and deserialize arrays', () => {
      const engine = new SerializationEngine()
      const data = [1, 2, 3, 'a', 'b', 'c']

      const serialized = engine.serialize(data, 'json')
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized).toEqual(data)
    })

    it('should serialize and deserialize nested objects', () => {
      const engine = new SerializationEngine()
      const data = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: 10001,
          },
        },
        tags: ['admin', 'user'],
      }

      const serialized = engine.serialize(data, 'json')
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized).toEqual(data)
    })

    it('should support pretty printing', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test' }

      const compact = engine.serialize(data, 'json')
      const pretty = engine.serialize(data, 'json', { pretty: true })

      expect(pretty.size).toBeGreaterThan(compact.size)
      expect(pretty.data).toContain('\n')
    })

    it('should return serialization result with size and format', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test' }

      const result = engine.serialize(data, 'json')

      expect(result.format).toBe('json')
      expect(result.size).toBeGreaterThan(0)
      expect(result.data).toBeDefined()
    })
  })

  describe('Special Types Support', () => {
    it('should serialize and deserialize Date objects', () => {
      const engine = new SerializationEngine()
      const date = new Date('2024-01-15T12:00:00Z')
      const data = { created: date }

      const serialized = engine.serialize(data, 'json', { includeType: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.created).toBeInstanceOf(Date)
      expect(deserialized.created.getTime()).toBe(date.getTime())
    })

    it('should serialize and deserialize BigInt values', () => {
      const engine = new SerializationEngine()
      const data = { bigNum: BigInt('9007199254740993') }

      const serialized = engine.serialize(data, 'json', { includeType: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.bigNum).toBe(BigInt('9007199254740993'))
    })

    it('should serialize and deserialize Map objects', () => {
      const engine = new SerializationEngine()
      const map = new Map([['a', 1], ['b', 2]])
      const data = { mapping: map }

      const serialized = engine.serialize(data, 'json', { includeType: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.mapping).toBeInstanceOf(Map)
      expect(deserialized.mapping.get('a')).toBe(1)
      expect(deserialized.mapping.get('b')).toBe(2)
    })

    it('should serialize and deserialize Set objects', () => {
      const engine = new SerializationEngine()
      const set = new Set([1, 2, 3])
      const data = { items: set }

      const serialized = engine.serialize(data, 'json', { includeType: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.items).toBeInstanceOf(Set)
      expect(deserialized.items.has(1)).toBe(true)
      expect(deserialized.items.has(2)).toBe(true)
      expect(deserialized.items.has(3)).toBe(true)
    })

    it('should serialize and deserialize Buffer/Uint8Array', () => {
      const engine = new SerializationEngine()
      const buffer = new Uint8Array([1, 2, 3, 4, 5])
      const data = { binary: buffer }

      const serialized = engine.serialize(data, 'json', { includeType: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.binary).toBeInstanceOf(Uint8Array)
      expect(Array.from(deserialized.binary)).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('Circular Reference Handling', () => {
    it('should handle circular references when enabled', () => {
      const engine = new SerializationEngine()
      const obj: any = { name: 'circular' }
      obj.self = obj

      const serialized = engine.serialize(obj, 'json', { handleCircular: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.name).toBe('circular')
      expect(deserialized.self).toBe(deserialized)
    })

    it('should throw on circular references by default', () => {
      const engine = new SerializationEngine()
      const obj: any = { name: 'circular' }
      obj.self = obj

      expect(() => engine.serialize(obj, 'json')).toThrow()
    })
  })

  describe('Undefined Handling', () => {
    it('should preserve undefined values when includeType is true', () => {
      const engine = new SerializationEngine()
      const data = { a: 1, b: undefined, c: 3 }

      const serialized = engine.serialize(data, 'json', { includeType: true })
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect('b' in deserialized).toBe(true)
      expect(deserialized.b).toBeUndefined()
    })

    it('should handle null values', () => {
      const engine = new SerializationEngine()
      const data = { a: null, b: 1 }

      const serialized = engine.serialize(data, 'json')
      const deserialized = engine.deserialize(serialized.data, 'json')

      expect(deserialized.a).toBeNull()
      expect(deserialized.b).toBe(1)
    })
  })

  describe('Binary Format (MsgPack)', () => {
    it('should serialize to binary format', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test', count: 42 }

      const serialized = engine.serialize(data, 'msgpack')

      expect(serialized.data).toBeInstanceOf(Uint8Array)
      expect(serialized.format).toBe('msgpack')
    })

    it('should deserialize from binary format', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test', count: 42 }

      const serialized = engine.serialize(data, 'msgpack')
      const deserialized = engine.deserialize(serialized.data, 'msgpack')

      expect(deserialized).toEqual(data)
    })

    it('should produce smaller output than JSON for typical data', () => {
      const engine = new SerializationEngine()
      const data = {
        users: Array.from({ length: 10 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          active: true,
        })),
      }

      const jsonResult = engine.serialize(data, 'json')
      const msgpackResult = engine.serialize(data, 'msgpack')

      expect(msgpackResult.size).toBeLessThan(jsonResult.size)
    })
  })

  describe('CBOR Format', () => {
    it('should serialize and deserialize with CBOR', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test', values: [1, 2, 3] }

      const serialized = engine.serialize(data, 'cbor')
      const deserialized = engine.deserialize(serialized.data, 'cbor')

      expect(serialized.data).toBeInstanceOf(Uint8Array)
      expect(deserialized).toEqual(data)
    })
  })

  describe('Format Conversion', () => {
    it('should convert from JSON to MsgPack', () => {
      const engine = new SerializationEngine()
      const jsonData = JSON.stringify({ name: 'test' })

      const converted = engine.convert(jsonData, 'json', 'msgpack')

      expect(converted.data).toBeInstanceOf(Uint8Array)
      expect(converted.format).toBe('msgpack')
    })

    it('should convert from MsgPack to JSON', () => {
      const engine = new SerializationEngine()
      const data = { name: 'test', count: 42 }
      const msgpackData = engine.serialize(data, 'msgpack')

      const converted = engine.convert(msgpackData.data, 'msgpack', 'json')

      expect(typeof converted.data).toBe('string')
      expect(JSON.parse(converted.data as string)).toEqual(data)
    })
  })

  describe('Custom Serializers', () => {
    it('should register and use custom serializers', () => {
      const engine = new SerializationEngine()

      const customSerializer: CustomSerializer = {
        serialize: (value: unknown) => {
          return new TextEncoder().encode(`CUSTOM:${JSON.stringify(value)}`)
        },
        deserialize: (data: Uint8Array | string) => {
          const str = data instanceof Uint8Array ? new TextDecoder().decode(data) : data
          return JSON.parse(str.replace('CUSTOM:', ''))
        },
      }

      engine.register('custom' as SerializationFormat, customSerializer)

      const data = { test: 'value' }
      const serialized = engine.serialize(data, 'custom' as SerializationFormat)
      const deserialized = engine.deserialize(serialized.data, 'custom' as SerializationFormat)

      expect(deserialized).toEqual(data)
    })
  })

  describe('Error Handling', () => {
    it('should throw on invalid JSON input', () => {
      const engine = new SerializationEngine()

      expect(() => engine.deserialize('invalid json {', 'json')).toThrow()
    })

    it('should throw on unknown format', () => {
      const engine = new SerializationEngine()

      expect(() => engine.serialize({}, 'unknown' as SerializationFormat)).toThrow()
    })

    it('should throw in strict mode for unknown types', () => {
      const engine = new SerializationEngine()
      // Create data with an unknown type marker
      const data = JSON.stringify({ __type: 'UnknownType', value: 'test' })

      expect(() => engine.deserialize(data, 'json', { strict: true })).toThrow()
    })
  })
})

describe('JSONSerializer', () => {
  it('should serialize simple values', () => {
    const serializer = new JSONSerializer()
    const result = serializer.serialize({ a: 1 })

    expect(typeof result).toBe('string')
    expect(JSON.parse(result as string)).toEqual({ a: 1 })
  })

  it('should support custom replacer', () => {
    const serializer = new JSONSerializer()
    const result = serializer.serialize(
      { password: 'secret', name: 'test' },
      { replacer: (key, value) => key === 'password' ? '***' : value }
    )

    expect(JSON.parse(result as string)).toEqual({ password: '***', name: 'test' })
  })
})

describe('MsgPackSerializer', () => {
  it('should serialize to Uint8Array', () => {
    const serializer = new MsgPackSerializer()
    const result = serializer.serialize({ a: 1 })

    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('should round-trip complex data', () => {
    const serializer = new MsgPackSerializer()
    const data = {
      string: 'hello',
      number: 42,
      float: 3.14,
      bool: true,
      null: null,
      array: [1, 2, 3],
      nested: { a: { b: { c: 1 } } },
    }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(data)
  })
})

describe('CBORSerializer', () => {
  it('should serialize to Uint8Array', () => {
    const serializer = new CBORSerializer()
    const result = serializer.serialize({ a: 1 })

    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('should round-trip data', () => {
    const serializer = new CBORSerializer()
    const data = { name: 'test', values: [1, 2, 3] }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(data)
  })
})

describe('TypedSerializer', () => {
  it('should preserve type information', () => {
    const serializer = new TypedSerializer()
    const date = new Date('2024-01-15')
    const data = { created: date }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.created).toBeInstanceOf(Date)
  })

  it('should handle nested special types', () => {
    const serializer = new TypedSerializer()
    const data = {
      metadata: {
        dates: [new Date('2024-01-01'), new Date('2024-01-02')],
        mapping: new Map([['key', new Set([1, 2, 3])]]),
      },
    }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.metadata.dates[0]).toBeInstanceOf(Date)
    expect(deserialized.metadata.mapping).toBeInstanceOf(Map)
    expect(deserialized.metadata.mapping.get('key')).toBeInstanceOf(Set)
  })
})

describe('StreamSerializer', () => {
  it('should serialize data in chunks', async () => {
    const serializer = new StreamSerializer()
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }))

    const chunks: Uint8Array[] = []
    for await (const chunk of serializer.serializeStream(data)) {
      chunks.push(chunk.data as Uint8Array)
    }

    expect(chunks.length).toBeGreaterThan(0)
  })

  it('should deserialize streamed data', async () => {
    const serializer = new StreamSerializer()
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }]

    const chunks: Uint8Array[] = []
    for await (const chunk of serializer.serializeStream(data)) {
      chunks.push(chunk.data as Uint8Array)
    }

    const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const deserialized = await serializer.deserializeStream(combined)
    expect(deserialized).toEqual(data)
  })
})

describe('CompressionAdapter', () => {
  it('should compress serialized data', async () => {
    const adapter = new CompressionAdapter({ algorithm: 'gzip' })
    const data = 'a'.repeat(1000) // Highly compressible
    const input = new TextEncoder().encode(data)

    const compressed = await adapter.compress(input)

    expect(compressed.length).toBeLessThan(input.length)
  })

  it('should decompress data back to original', async () => {
    const adapter = new CompressionAdapter({ algorithm: 'gzip' })
    const original = 'test data for compression'
    const input = new TextEncoder().encode(original)

    const compressed = await adapter.compress(input)
    const decompressed = await adapter.decompress(compressed)

    expect(new TextDecoder().decode(decompressed)).toBe(original)
  })

  it('should pass through when algorithm is none', async () => {
    const adapter = new CompressionAdapter({ algorithm: 'none' })
    const input = new Uint8Array([1, 2, 3, 4, 5])

    const result = await adapter.compress(input)

    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('Schema-based Serialization', () => {
  it('should validate data against schema', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'User',
      fields: {
        name: { type: 'string', required: true },
        age: { type: 'number' },
      },
    }

    const validData = { name: 'John', age: 30 }
    const serialized = engine.serializeWithSchema(validData, schema, 'json')

    expect(serialized.data).toBeDefined()
  })

  it('should throw on schema validation failure', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'User',
      fields: {
        name: { type: 'string', required: true },
        age: { type: 'number' },
      },
    }

    const invalidData = { age: 'not a number' } // Missing required 'name'

    expect(() => engine.serializeWithSchema(invalidData, schema, 'json')).toThrow()
  })
})

describe('Size Comparison', () => {
  it('should report accurate sizes for all formats', () => {
    const engine = new SerializationEngine()
    const data = {
      users: Array.from({ length: 5 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        active: true,
      })),
    }

    const jsonResult = engine.serialize(data, 'json')
    const msgpackResult = engine.serialize(data, 'msgpack')
    const cborResult = engine.serialize(data, 'cbor')

    // JSON is typically larger
    expect(jsonResult.size).toBeGreaterThan(0)
    expect(msgpackResult.size).toBeGreaterThan(0)
    expect(cborResult.size).toBeGreaterThan(0)

    // Binary formats should be smaller
    expect(msgpackResult.size).toBeLessThan(jsonResult.size)
  })
})

describe('Protobuf-like Format', () => {
  it('should serialize and deserialize with protobuf-like format', () => {
    const engine = new SerializationEngine()
    const data = { name: 'test', id: 123, active: true }

    const serialized = engine.serialize(data, 'protobuf-like')
    const deserialized = engine.deserialize(serialized.data, 'protobuf-like')

    expect(serialized.data).toBeInstanceOf(Uint8Array)
    expect(serialized.format).toBe('protobuf-like')
    expect(deserialized).toEqual(data)
  })
})

describe('MsgPackSerializer Edge Cases', () => {
  it('should handle negative numbers', () => {
    const serializer = new MsgPackSerializer()
    const data = { a: -1, b: -32, c: -128, d: -1000 }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(data)
  })

  it('should handle large integers', () => {
    const serializer = new MsgPackSerializer()
    const data = { small: 127, medium: 255, large: 65535, veryLarge: 16777215 }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(data)
  })

  it('should handle floating point numbers', () => {
    const serializer = new MsgPackSerializer()
    const data = { pi: 3.14159, e: 2.71828, negative: -1.5 }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.pi).toBeCloseTo(3.14159)
    expect(deserialized.e).toBeCloseTo(2.71828)
    expect(deserialized.negative).toBeCloseTo(-1.5)
  })

  it('should handle empty objects and arrays', () => {
    const serializer = new MsgPackSerializer()
    const data = { emptyObj: {}, emptyArr: [] }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(data)
  })

  it('should handle long strings', () => {
    const serializer = new MsgPackSerializer()
    const longString = 'a'.repeat(500)
    const data = { text: longString }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.text).toBe(longString)
  })
})

describe('CBORSerializer Edge Cases', () => {
  it('should handle undefined values', () => {
    const serializer = new CBORSerializer()
    const data = { a: 1, b: undefined, c: 3 }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.a).toBe(1)
    expect(deserialized.b).toBeUndefined()
    expect(deserialized.c).toBe(3)
  })

  it('should handle negative numbers', () => {
    const serializer = new CBORSerializer()
    const data = { neg1: -1, neg100: -100, neg10000: -10000 }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(data)
  })

  it('should handle deeply nested structures', () => {
    const serializer = new CBORSerializer()
    const data = { a: { b: { c: { d: { e: { f: 'deep' } } } } } }

    const serialized = serializer.serialize(data)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.a.b.c.d.e.f).toBe('deep')
  })
})

describe('JSONSerializer Edge Cases', () => {
  it('should handle custom reviver', () => {
    const serializer = new JSONSerializer()
    const json = JSON.stringify({ count: '42', name: 'test' })

    const result = serializer.deserialize(json, {
      reviver: (key, value) => key === 'count' ? parseInt(value as string, 10) : value
    })

    expect(result.count).toBe(42)
    expect(typeof result.count).toBe('number')
  })

  it('should handle arrays with special types', () => {
    const serializer = new JSONSerializer()
    const data = {
      dates: [new Date('2024-01-01'), new Date('2024-06-15')],
      sets: [new Set([1, 2]), new Set(['a', 'b'])],
    }

    const serialized = serializer.serialize(data, { includeType: true })
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized.dates[0]).toBeInstanceOf(Date)
    expect(deserialized.dates[1]).toBeInstanceOf(Date)
    expect(deserialized.sets[0]).toBeInstanceOf(Set)
    expect(deserialized.sets[1]).toBeInstanceOf(Set)
  })
})

describe('Schema Validation Edge Cases', () => {
  it('should validate nested object schemas', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Order',
      fields: {
        id: { type: 'number', required: true },
        items: { type: 'array', required: true },
        status: { type: 'string' },
      },
    }

    const validData = { id: 1, items: ['item1', 'item2'], status: 'pending' }
    const result = engine.serializeWithSchema(validData, schema, 'json')

    expect(result.data).toBeDefined()
  })

  it('should reject invalid type for required field', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Product',
      fields: {
        name: { type: 'string', required: true },
        price: { type: 'number', required: true },
      },
    }

    const invalidData = { name: 'Widget', price: 'not-a-number' }

    expect(() => engine.serializeWithSchema(invalidData, schema, 'json')).toThrow()
  })

  it('should validate boolean fields', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Settings',
      fields: {
        enabled: { type: 'boolean', required: true },
      },
    }

    const validData = { enabled: true }
    const result = engine.serializeWithSchema(validData, schema, 'json')
    expect(result.data).toBeDefined()

    const invalidData = { enabled: 'yes' }
    expect(() => engine.serializeWithSchema(invalidData, schema, 'json')).toThrow()
  })

  it('should validate Map fields', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Cache',
      fields: {
        entries: { type: 'map', required: true },
      },
    }

    const validData = { entries: new Map([['key1', 'value1']]) }
    const result = engine.serializeWithSchema(validData, schema, 'json', { includeType: true })
    expect(result.data).toBeDefined()

    const invalidData = { entries: { key1: 'value1' } }
    expect(() => engine.serializeWithSchema(invalidData, schema, 'json')).toThrow()
  })

  it('should validate Set fields', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Tags',
      fields: {
        tags: { type: 'set', required: true },
      },
    }

    const validData = { tags: new Set(['tag1', 'tag2']) }
    const result = engine.serializeWithSchema(validData, schema, 'json', { includeType: true })
    expect(result.data).toBeDefined()

    const invalidData = { tags: ['tag1', 'tag2'] }
    expect(() => engine.serializeWithSchema(invalidData, schema, 'json')).toThrow()
  })

  it('should validate buffer fields', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Binary',
      fields: {
        data: { type: 'buffer', required: true },
      },
    }

    const validData = { data: new Uint8Array([1, 2, 3]) }
    const result = engine.serializeWithSchema(validData, schema, 'json', { includeType: true })
    expect(result.data).toBeDefined()

    const invalidData = { data: [1, 2, 3] }
    expect(() => engine.serializeWithSchema(invalidData, schema, 'json')).toThrow()
  })

  it('should allow optional fields to be missing', () => {
    const engine = new SerializationEngine()
    const schema: Schema = {
      name: 'Profile',
      fields: {
        name: { type: 'string', required: true },
        bio: { type: 'string', required: false },
        age: { type: 'number' },
      },
    }

    const dataWithoutOptional = { name: 'Alice' }
    const result = engine.serializeWithSchema(dataWithoutOptional, schema, 'json')
    expect(result.data).toBeDefined()
  })
})

describe('Format Conversion Edge Cases', () => {
  it('should convert from CBOR to JSON', () => {
    const engine = new SerializationEngine()
    const data = { name: 'test', values: [1, 2, 3] }
    const cborData = engine.serialize(data, 'cbor')

    const converted = engine.convert(cborData.data, 'cbor', 'json')

    expect(typeof converted.data).toBe('string')
    expect(JSON.parse(converted.data as string)).toEqual(data)
  })

  it('should convert from JSON to CBOR', () => {
    const engine = new SerializationEngine()
    const jsonData = JSON.stringify({ count: 42, active: true })

    const converted = engine.convert(jsonData, 'json', 'cbor')

    expect(converted.data).toBeInstanceOf(Uint8Array)
    expect(converted.format).toBe('cbor')
  })

  it('should preserve data through multiple conversions', () => {
    const engine = new SerializationEngine()
    const original = { name: 'test', count: 42, items: ['a', 'b', 'c'] }

    const json = engine.serialize(original, 'json')
    const msgpack = engine.convert(json.data, 'json', 'msgpack')
    const cbor = engine.convert(msgpack.data, 'msgpack', 'cbor')
    const backToJson = engine.convert(cbor.data, 'cbor', 'json')

    const final = JSON.parse(backToJson.data as string)
    expect(final).toEqual(original)
  })
})

describe('StreamSerializer Edge Cases', () => {
  it('should handle empty arrays', async () => {
    const serializer = new StreamSerializer()
    const data: unknown[] = []

    const chunks: Uint8Array[] = []
    for await (const chunk of serializer.serializeStream(data)) {
      chunks.push(chunk.data as Uint8Array)
    }

    const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const deserialized = await serializer.deserializeStream(combined)
    expect(deserialized).toEqual([])
  })

  it('should mark final chunk correctly', async () => {
    const serializer = new StreamSerializer()
    const data = [{ id: 1 }]

    let lastChunk
    for await (const chunk of serializer.serializeStream(data)) {
      lastChunk = chunk
    }

    expect(lastChunk?.final).toBe(true)
  })

  it('should increment chunk indices', async () => {
    const serializer = new StreamSerializer(10) // Small chunk size
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }))

    const indices: number[] = []
    for await (const chunk of serializer.serializeStream(data)) {
      indices.push(chunk.index)
    }

    expect(indices).toEqual(indices.map((_, i) => i))
  })
})
