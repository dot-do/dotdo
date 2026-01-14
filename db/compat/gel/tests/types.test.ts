/**
 * RED Phase: Type System Tests
 *
 * Tests for EdgeDB/Gel type system compatibility layer.
 * Maps EdgeDB types to SQLite storage and JavaScript runtime types.
 *
 * @see ../spike-type-system.md for the complete type mapping matrix
 *
 * These tests MUST FAIL until the types module is implemented (GREEN phase).
 */

import { describe, it, expect } from 'vitest'

// Import from module that DOES NOT EXIST YET
// This will cause tests to fail in RED phase
import {
  // Serializers (JS -> SQLite)
  serializeStr,
  serializeBool,
  serializeUuid,
  serializeInt16,
  serializeInt32,
  serializeInt64,
  serializeFloat32,
  serializeFloat64,
  serializeBigInt,
  serializeDecimal,
  serializeJson,
  serializeBytes,
  serializeDatetime,
  serializeDuration,
  serializeRelativeDuration,
  serializeDateDuration,
  serializeLocalDate,
  serializeLocalTime,
  serializeLocalDateTime,
  serializeEnum,
  serializeArray,
  serializeTuple,
  serializeRange,
  serializeMultiRange,

  // Deserializers (SQLite -> JS)
  deserializeStr,
  deserializeBool,
  deserializeUuid,
  deserializeInt16,
  deserializeInt32,
  deserializeInt64,
  deserializeFloat32,
  deserializeFloat64,
  deserializeBigInt,
  deserializeDecimal,
  deserializeJson,
  deserializeBytes,
  deserializeDatetime,
  deserializeDuration,
  deserializeRelativeDuration,
  deserializeDateDuration,
  deserializeLocalDate,
  deserializeLocalTime,
  deserializeLocalDateTime,
  deserializeEnum,
  deserializeArray,
  deserializeTuple,
  deserializeRange,
  deserializeMultiRange,

  // Validators
  validateStr,
  validateBool,
  validateUuid,
  validateInt16,
  validateInt32,
  validateInt64,
  validateFloat32,
  validateFloat64,
  validateBigInt,
  validateDecimal,
  validateJson,
  validateBytes,
  validateDatetime,
  validateDuration,
  validateLocalDate,
  validateLocalTime,
  validateLocalDateTime,
  validateEnum,

  // Cardinality
  validateRequired,
  validateAtLeastOne,
  deserializeCardinality,
  CardinalityError,

  // Type interfaces
  type Duration,
  type RelativeDuration,
  type DateDuration,
  type LocalDate,
  type LocalTime,
  type LocalDateTime,
  type Range,
  type JsonValue,
} from '../types'

// =============================================================================
// STRING TYPE (str)
// =============================================================================

describe('str type', () => {
  describe('serialization (JS -> SQLite)', () => {
    it('serializes empty string', () => {
      expect(serializeStr('')).toBe('')
    })

    it('serializes simple string', () => {
      expect(serializeStr('hello world')).toBe('hello world')
    })

    it('preserves unicode characters', () => {
      expect(serializeStr('Hello \u4e16\u754c')).toBe('Hello \u4e16\u754c')
    })

    it('preserves emoji characters', () => {
      expect(serializeStr('\u{1F680}\u{1F30D}')).toBe('\u{1F680}\u{1F30D}')
    })

    it('handles very long strings', () => {
      const longStr = 'x'.repeat(100000)
      expect(serializeStr(longStr)).toBe(longStr)
    })

    it('preserves newlines and whitespace', () => {
      const multiline = 'line1\nline2\r\n\ttabbed'
      expect(serializeStr(multiline)).toBe(multiline)
    })
  })

  describe('deserialization (SQLite -> JS)', () => {
    it('deserializes empty string', () => {
      expect(deserializeStr('')).toBe('')
    })

    it('deserializes simple string', () => {
      expect(deserializeStr('hello world')).toBe('hello world')
    })

    it('preserves unicode on deserialization', () => {
      expect(deserializeStr('Hello \u4e16\u754c')).toBe('Hello \u4e16\u754c')
    })
  })

  describe('round-trip', () => {
    it('round-trips various strings', () => {
      const testCases = [
        '',
        'hello',
        'Hello \u4e16\u754c',
        '\u{1F680}',
        'line1\nline2',
        'a'.repeat(10000),
      ]

      for (const str of testCases) {
        expect(deserializeStr(serializeStr(str))).toBe(str)
      }
    })
  })

  describe('validation', () => {
    it('validates strings', () => {
      expect(validateStr('hello')).toBe(true)
      expect(validateStr('')).toBe(true)
    })

    it('rejects non-strings', () => {
      expect(validateStr(123)).toBe(false)
      expect(validateStr(null)).toBe(false)
      expect(validateStr(undefined)).toBe(false)
      expect(validateStr({ key: 'value' })).toBe(false)
      expect(validateStr(['array'])).toBe(false)
    })
  })
})

// =============================================================================
// BOOLEAN TYPE (bool)
// =============================================================================

describe('bool type', () => {
  describe('serialization (JS -> SQLite INTEGER)', () => {
    it('serializes true to 1', () => {
      expect(serializeBool(true)).toBe(1)
    })

    it('serializes false to 0', () => {
      expect(serializeBool(false)).toBe(0)
    })
  })

  describe('deserialization (SQLite INTEGER -> JS)', () => {
    it('deserializes 1 to true', () => {
      expect(deserializeBool(1)).toBe(true)
    })

    it('deserializes 0 to false', () => {
      expect(deserializeBool(0)).toBe(false)
    })

    it('treats any non-zero as true', () => {
      expect(deserializeBool(42)).toBe(true)
      expect(deserializeBool(-1)).toBe(true)
    })
  })

  describe('round-trip', () => {
    it('round-trips true', () => {
      expect(deserializeBool(serializeBool(true))).toBe(true)
    })

    it('round-trips false', () => {
      expect(deserializeBool(serializeBool(false))).toBe(false)
    })
  })

  describe('validation', () => {
    it('validates booleans', () => {
      expect(validateBool(true)).toBe(true)
      expect(validateBool(false)).toBe(true)
    })

    it('rejects non-booleans', () => {
      expect(validateBool(1)).toBe(false)
      expect(validateBool(0)).toBe(false)
      expect(validateBool('true')).toBe(false)
      expect(validateBool(null)).toBe(false)
    })
  })
})

// =============================================================================
// UUID TYPE
// =============================================================================

describe('uuid type', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000'
  const validUuidUppercase = '550E8400-E29B-41D4-A716-446655440000'

  describe('serialization (JS -> SQLite TEXT)', () => {
    it('serializes valid lowercase UUID', () => {
      expect(serializeUuid(validUuid)).toBe(validUuid)
    })

    it('normalizes uppercase UUID to lowercase', () => {
      expect(serializeUuid(validUuidUppercase)).toBe(validUuid)
    })

    it('throws on invalid UUID format', () => {
      expect(() => serializeUuid('not-a-uuid')).toThrow(TypeError)
    })

    it('throws on UUID without dashes', () => {
      expect(() => serializeUuid('550e8400e29b41d4a716446655440000')).toThrow(TypeError)
    })

    it('throws on wrong length', () => {
      expect(() => serializeUuid('550e8400-e29b-41d4-a716')).toThrow(TypeError)
    })

    it('throws on invalid characters', () => {
      expect(() => serializeUuid('550e8400-e29b-41d4-a716-44665544000g')).toThrow(TypeError)
    })
  })

  describe('deserialization (SQLite TEXT -> JS)', () => {
    it('deserializes valid UUID', () => {
      expect(deserializeUuid(validUuid)).toBe(validUuid)
    })
  })

  describe('round-trip', () => {
    it('round-trips UUID', () => {
      expect(deserializeUuid(serializeUuid(validUuid))).toBe(validUuid)
    })

    it('normalizes case on round-trip', () => {
      expect(deserializeUuid(serializeUuid(validUuidUppercase))).toBe(validUuid)
    })
  })

  describe('validation', () => {
    it('validates correct UUID format', () => {
      expect(validateUuid(validUuid)).toBe(true)
      expect(validateUuid(validUuidUppercase)).toBe(true)
    })

    it('rejects invalid UUIDs', () => {
      expect(validateUuid('not-a-uuid')).toBe(false)
      expect(validateUuid('')).toBe(false)
      expect(validateUuid(null)).toBe(false)
      expect(validateUuid(123)).toBe(false)
    })
  })
})

// =============================================================================
// INTEGER TYPES (int16, int32, int64)
// =============================================================================

describe('int16 type', () => {
  const MIN_INT16 = -32768
  const MAX_INT16 = 32767

  describe('serialization', () => {
    it('serializes zero', () => {
      expect(serializeInt16(0)).toBe(0)
    })

    it('serializes positive integers', () => {
      expect(serializeInt16(100)).toBe(100)
      expect(serializeInt16(MAX_INT16)).toBe(MAX_INT16)
    })

    it('serializes negative integers', () => {
      expect(serializeInt16(-100)).toBe(-100)
      expect(serializeInt16(MIN_INT16)).toBe(MIN_INT16)
    })

    it('throws on overflow', () => {
      expect(() => serializeInt16(MAX_INT16 + 1)).toThrow(RangeError)
    })

    it('throws on underflow', () => {
      expect(() => serializeInt16(MIN_INT16 - 1)).toThrow(RangeError)
    })

    it('throws on non-integer', () => {
      expect(() => serializeInt16(1.5)).toThrow()
    })
  })

  describe('deserialization', () => {
    it('deserializes valid int16 values', () => {
      expect(deserializeInt16(0)).toBe(0)
      expect(deserializeInt16(100)).toBe(100)
      expect(deserializeInt16(-100)).toBe(-100)
    })
  })

  describe('round-trip', () => {
    it('round-trips boundary values', () => {
      expect(deserializeInt16(serializeInt16(MIN_INT16))).toBe(MIN_INT16)
      expect(deserializeInt16(serializeInt16(MAX_INT16))).toBe(MAX_INT16)
    })
  })

  describe('validation', () => {
    it('validates int16 values', () => {
      expect(validateInt16(0)).toBe(true)
      expect(validateInt16(100)).toBe(true)
      expect(validateInt16(MAX_INT16)).toBe(true)
      expect(validateInt16(MIN_INT16)).toBe(true)
    })

    it('rejects out-of-range values', () => {
      expect(validateInt16(MAX_INT16 + 1)).toBe(false)
      expect(validateInt16(MIN_INT16 - 1)).toBe(false)
    })

    it('rejects non-integers', () => {
      expect(validateInt16(1.5)).toBe(false)
      expect(validateInt16('100')).toBe(false)
    })
  })
})

describe('int32 type', () => {
  const MIN_INT32 = -2147483648
  const MAX_INT32 = 2147483647

  describe('serialization', () => {
    it('serializes valid int32 values', () => {
      expect(serializeInt32(0)).toBe(0)
      expect(serializeInt32(MAX_INT32)).toBe(MAX_INT32)
      expect(serializeInt32(MIN_INT32)).toBe(MIN_INT32)
    })

    it('throws on overflow', () => {
      expect(() => serializeInt32(MAX_INT32 + 1)).toThrow(RangeError)
    })

    it('throws on underflow', () => {
      expect(() => serializeInt32(MIN_INT32 - 1)).toThrow(RangeError)
    })
  })

  describe('round-trip', () => {
    it('round-trips boundary values', () => {
      expect(deserializeInt32(serializeInt32(MIN_INT32))).toBe(MIN_INT32)
      expect(deserializeInt32(serializeInt32(MAX_INT32))).toBe(MAX_INT32)
    })
  })

  describe('validation', () => {
    it('validates int32 values', () => {
      expect(validateInt32(0)).toBe(true)
      expect(validateInt32(MAX_INT32)).toBe(true)
      expect(validateInt32(MIN_INT32)).toBe(true)
    })

    it('rejects out-of-range values', () => {
      expect(validateInt32(MAX_INT32 + 1)).toBe(false)
      expect(validateInt32(MIN_INT32 - 1)).toBe(false)
    })
  })
})

describe('int64 type', () => {
  const MIN_INT64 = BigInt('-9223372036854775808')
  const MAX_INT64 = BigInt('9223372036854775807')
  const SAFE_INTEGER = Number.MAX_SAFE_INTEGER

  describe('serialization', () => {
    it('serializes number values', () => {
      expect(serializeInt64(0)).toBe(0)
      expect(serializeInt64(1000000)).toBe(1000000)
    })

    it('serializes bigint values', () => {
      expect(serializeInt64(BigInt(0))).toBe(0)
      expect(serializeInt64(MAX_INT64)).toBeDefined()
    })

    it('throws on bigint overflow', () => {
      expect(() => serializeInt64(MAX_INT64 + BigInt(1))).toThrow(RangeError)
    })

    it('throws on bigint underflow', () => {
      expect(() => serializeInt64(MIN_INT64 - BigInt(1))).toThrow(RangeError)
    })
  })

  describe('deserialization', () => {
    it('deserializes safe integers as number by default', () => {
      const result = deserializeInt64(100)
      expect(result).toBe(100)
      expect(typeof result).toBe('number')
    })

    it('deserializes as bigint when useBigInt=true', () => {
      const result = deserializeInt64(100, true)
      expect(result).toBe(BigInt(100))
      expect(typeof result).toBe('bigint')
    })

    it('deserializes unsafe integers as bigint automatically', () => {
      // SQLite stores 64-bit integers, values > 2^53 need bigint
      const unsafeValue = SAFE_INTEGER + 100
      const result = deserializeInt64(unsafeValue)
      expect(typeof result).toBe('bigint')
    })
  })

  describe('validation', () => {
    it('validates int64 number values', () => {
      expect(validateInt64(0)).toBe(true)
      expect(validateInt64(SAFE_INTEGER)).toBe(true)
    })

    it('validates int64 bigint values', () => {
      expect(validateInt64(BigInt(0))).toBe(true)
      expect(validateInt64(MAX_INT64)).toBe(true)
      expect(validateInt64(MIN_INT64)).toBe(true)
    })

    it('rejects out-of-range bigint', () => {
      expect(validateInt64(MAX_INT64 + BigInt(1))).toBe(false)
      expect(validateInt64(MIN_INT64 - BigInt(1))).toBe(false)
    })
  })
})

// =============================================================================
// FLOATING POINT TYPES (float32, float64)
// =============================================================================

describe('float32 type', () => {
  describe('serialization', () => {
    it('serializes finite floats', () => {
      expect(serializeFloat32(0.0)).toBe(0.0)
      expect(serializeFloat32(3.14)).toBeCloseTo(3.14)
      expect(serializeFloat32(-1.5)).toBe(-1.5)
    })

    it('serializes NaN', () => {
      expect(Number.isNaN(serializeFloat32(NaN))).toBe(true)
    })

    it('throws on infinity', () => {
      expect(() => serializeFloat32(Infinity)).toThrow(RangeError)
      expect(() => serializeFloat32(-Infinity)).toThrow(RangeError)
    })
  })

  describe('deserialization', () => {
    it('deserializes floats', () => {
      expect(deserializeFloat32(3.14)).toBeCloseTo(3.14)
    })
  })

  describe('validation', () => {
    it('validates finite floats', () => {
      expect(validateFloat32(0.0)).toBe(true)
      expect(validateFloat32(3.14)).toBe(true)
      expect(validateFloat32(NaN)).toBe(true) // NaN is a valid float
    })

    it('rejects infinity', () => {
      expect(validateFloat32(Infinity)).toBe(false)
      expect(validateFloat32(-Infinity)).toBe(false)
    })

    it('rejects non-numbers', () => {
      expect(validateFloat32('3.14')).toBe(false)
      expect(validateFloat32(null)).toBe(false)
    })
  })
})

describe('float64 type', () => {
  describe('serialization', () => {
    it('serializes precise doubles', () => {
      expect(serializeFloat64(0.0)).toBe(0.0)
      expect(serializeFloat64(3.141592653589793)).toBe(3.141592653589793)
      expect(serializeFloat64(1e308)).toBe(1e308)
    })

    it('serializes negative floats', () => {
      expect(serializeFloat64(-1e308)).toBe(-1e308)
    })
  })

  describe('deserialization', () => {
    it('deserializes float64 values', () => {
      expect(deserializeFloat64(3.141592653589793)).toBe(3.141592653589793)
    })
  })

  describe('round-trip', () => {
    it('preserves float64 precision', () => {
      const precise = 3.141592653589793
      expect(deserializeFloat64(serializeFloat64(precise))).toBe(precise)
    })
  })

  describe('validation', () => {
    it('validates float64 values', () => {
      expect(validateFloat64(0.0)).toBe(true)
      expect(validateFloat64(1e308)).toBe(true)
      expect(validateFloat64(-1e308)).toBe(true)
    })
  })
})

// =============================================================================
// ARBITRARY PRECISION TYPES (bigint, decimal)
// =============================================================================

describe('bigint type (EdgeDB bigint)', () => {
  describe('serialization (JS bigint -> SQLite TEXT)', () => {
    it('serializes positive bigint', () => {
      expect(serializeBigInt(BigInt('12345678901234567890'))).toBe('12345678901234567890')
    })

    it('serializes negative bigint', () => {
      expect(serializeBigInt(BigInt('-12345678901234567890'))).toBe('-12345678901234567890')
    })

    it('serializes zero', () => {
      expect(serializeBigInt(BigInt(0))).toBe('0')
    })
  })

  describe('deserialization (SQLite TEXT -> JS bigint)', () => {
    it('deserializes positive bigint', () => {
      expect(deserializeBigInt('12345678901234567890')).toBe(BigInt('12345678901234567890'))
    })

    it('deserializes negative bigint', () => {
      expect(deserializeBigInt('-12345678901234567890')).toBe(BigInt('-12345678901234567890'))
    })
  })

  describe('round-trip', () => {
    it('preserves arbitrary precision', () => {
      const huge = BigInt('123456789012345678901234567890123456789012345678901234567890')
      expect(deserializeBigInt(serializeBigInt(huge))).toBe(huge)
    })
  })

  describe('validation', () => {
    it('validates bigint values', () => {
      expect(validateBigInt(BigInt(100))).toBe(true)
      expect(validateBigInt(BigInt('-999999999999999999999999'))).toBe(true)
    })

    it('rejects non-bigint', () => {
      expect(validateBigInt(100)).toBe(false)
      expect(validateBigInt('100')).toBe(false)
    })
  })
})

describe('decimal type', () => {
  describe('serialization (JS string -> SQLite TEXT)', () => {
    it('serializes simple decimal', () => {
      expect(serializeDecimal('123.45')).toBe('123.45')
    })

    it('serializes negative decimal', () => {
      expect(serializeDecimal('-123.45')).toBe('-123.45')
    })

    it('serializes integer as decimal', () => {
      expect(serializeDecimal('100')).toBe('100')
    })

    it('serializes scientific notation', () => {
      expect(serializeDecimal('1.5e10')).toBe('1.5e10')
    })

    it('throws on invalid decimal format', () => {
      expect(() => serializeDecimal('abc')).toThrow(TypeError)
      expect(() => serializeDecimal('12.34.56')).toThrow(TypeError)
    })
  })

  describe('deserialization (SQLite TEXT -> JS string)', () => {
    it('deserializes decimal strings', () => {
      expect(deserializeDecimal('123.456789012345678901234567890')).toBe('123.456789012345678901234567890')
    })
  })

  describe('round-trip', () => {
    it('preserves arbitrary precision', () => {
      const precise = '123.456789012345678901234567890123456789'
      expect(deserializeDecimal(serializeDecimal(precise))).toBe(precise)
    })
  })

  describe('validation', () => {
    it('validates decimal strings', () => {
      expect(validateDecimal('123.45')).toBe(true)
      expect(validateDecimal('-123.45')).toBe(true)
      expect(validateDecimal('1e10')).toBe(true)
    })

    it('rejects invalid formats', () => {
      expect(validateDecimal('abc')).toBe(false)
      expect(validateDecimal('')).toBe(false)
      expect(validateDecimal(123.45)).toBe(false) // Must be string
    })
  })
})

// =============================================================================
// JSON TYPE
// =============================================================================

describe('json type', () => {
  describe('serialization (JS value -> SQLite TEXT)', () => {
    it('serializes null', () => {
      expect(serializeJson(null)).toBe('null')
    })

    it('serializes boolean', () => {
      expect(serializeJson(true)).toBe('true')
      expect(serializeJson(false)).toBe('false')
    })

    it('serializes number', () => {
      expect(serializeJson(42)).toBe('42')
      expect(serializeJson(3.14)).toBe('3.14')
    })

    it('serializes string', () => {
      expect(serializeJson('hello')).toBe('"hello"')
    })

    it('serializes array', () => {
      expect(serializeJson([1, 2, 3])).toBe('[1,2,3]')
    })

    it('serializes object', () => {
      expect(serializeJson({ key: 'value' })).toBe('{"key":"value"}')
    })

    it('serializes nested structures', () => {
      const nested = { arr: [1, { nested: true }], str: 'hello' }
      expect(JSON.parse(serializeJson(nested))).toEqual(nested)
    })
  })

  describe('deserialization (SQLite TEXT -> JS value)', () => {
    it('deserializes null', () => {
      expect(deserializeJson('null')).toBe(null)
    })

    it('deserializes boolean', () => {
      expect(deserializeJson('true')).toBe(true)
      expect(deserializeJson('false')).toBe(false)
    })

    it('deserializes number', () => {
      expect(deserializeJson('42')).toBe(42)
    })

    it('deserializes string', () => {
      expect(deserializeJson('"hello"')).toBe('hello')
    })

    it('deserializes array', () => {
      expect(deserializeJson('[1,2,3]')).toEqual([1, 2, 3])
    })

    it('deserializes object', () => {
      expect(deserializeJson('{"key":"value"}')).toEqual({ key: 'value' })
    })
  })

  describe('round-trip', () => {
    it('round-trips complex JSON', () => {
      const complex: JsonValue = {
        str: 'hello',
        num: 42,
        bool: true,
        arr: [1, 2, 3],
        nested: { deep: { value: 'found' } },
        nullVal: null,
      }
      expect(deserializeJson(serializeJson(complex))).toEqual(complex)
    })
  })

  describe('validation', () => {
    it('validates JSON values', () => {
      expect(validateJson(null)).toBe(true)
      expect(validateJson(true)).toBe(true)
      expect(validateJson(42)).toBe(true)
      expect(validateJson('hello')).toBe(true)
      expect(validateJson([1, 2, 3])).toBe(true)
      expect(validateJson({ key: 'value' })).toBe(true)
    })

    it('rejects undefined', () => {
      expect(validateJson(undefined)).toBe(false)
    })

    it('rejects functions', () => {
      expect(validateJson(() => {})).toBe(false)
    })

    it('rejects symbols', () => {
      expect(validateJson(Symbol('test'))).toBe(false)
    })
  })
})

// =============================================================================
// BYTES TYPE
// =============================================================================

describe('bytes type', () => {
  describe('serialization (JS Uint8Array -> SQLite BLOB)', () => {
    it('serializes empty bytes', () => {
      const bytes = new Uint8Array([])
      expect(serializeBytes(bytes)).toEqual(bytes)
    })

    it('serializes byte array', () => {
      const bytes = new Uint8Array([0, 1, 2, 255])
      expect(serializeBytes(bytes)).toEqual(bytes)
    })

    it('serializes large byte array', () => {
      const bytes = new Uint8Array(10000).fill(42)
      expect(serializeBytes(bytes)).toEqual(bytes)
    })
  })

  describe('deserialization (SQLite BLOB -> JS Uint8Array)', () => {
    it('deserializes Uint8Array', () => {
      const bytes = new Uint8Array([0, 1, 2, 255])
      expect(deserializeBytes(bytes)).toEqual(bytes)
    })

    it('deserializes ArrayBuffer', () => {
      const buffer = new ArrayBuffer(4)
      const view = new Uint8Array(buffer)
      view.set([0, 1, 2, 255])
      expect(deserializeBytes(buffer)).toEqual(new Uint8Array([0, 1, 2, 255]))
    })
  })

  describe('round-trip', () => {
    it('round-trips bytes', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255])
      expect(deserializeBytes(serializeBytes(original))).toEqual(original)
    })
  })

  describe('validation', () => {
    it('validates Uint8Array', () => {
      expect(validateBytes(new Uint8Array([]))).toBe(true)
      expect(validateBytes(new Uint8Array([1, 2, 3]))).toBe(true)
    })

    it('rejects non-Uint8Array', () => {
      expect(validateBytes([1, 2, 3])).toBe(false)
      expect(validateBytes('binary')).toBe(false)
      expect(validateBytes(null)).toBe(false)
    })
  })
})

// =============================================================================
// DATETIME TYPE
// =============================================================================

describe('datetime type', () => {
  describe('serialization (JS Date -> SQLite TEXT ISO8601)', () => {
    it('serializes Date to ISO 8601 UTC', () => {
      const date = new Date('2024-01-15T10:30:00.000Z')
      expect(serializeDatetime(date)).toBe('2024-01-15T10:30:00.000Z')
    })

    it('normalizes to UTC', () => {
      // Date with offset should be normalized to UTC
      const date = new Date('2024-01-15T10:30:00+05:00')
      expect(serializeDatetime(date)).toBe('2024-01-15T05:30:00.000Z')
    })

    it('preserves milliseconds', () => {
      const date = new Date('2024-01-15T10:30:00.123Z')
      expect(serializeDatetime(date)).toBe('2024-01-15T10:30:00.123Z')
    })
  })

  describe('deserialization (SQLite TEXT -> JS Date)', () => {
    it('deserializes ISO 8601 string', () => {
      const result = deserializeDatetime('2024-01-15T10:30:00.000Z')
      expect(result).toBeInstanceOf(Date)
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('throws on invalid datetime', () => {
      expect(() => deserializeDatetime('not-a-date')).toThrow(TypeError)
    })

    it('throws on invalid ISO format', () => {
      expect(() => deserializeDatetime('2024/01/15')).toThrow(TypeError)
    })
  })

  describe('round-trip', () => {
    it('round-trips datetime', () => {
      const original = new Date('2024-06-15T14:30:45.123Z')
      const roundTripped = deserializeDatetime(serializeDatetime(original))
      expect(roundTripped.getTime()).toBe(original.getTime())
    })
  })

  describe('validation', () => {
    it('validates Date objects', () => {
      expect(validateDatetime(new Date())).toBe(true)
      expect(validateDatetime(new Date('2024-01-15'))).toBe(true)
    })

    it('rejects invalid Date', () => {
      expect(validateDatetime(new Date('invalid'))).toBe(false)
    })

    it('rejects non-Date', () => {
      expect(validateDatetime('2024-01-15')).toBe(false)
      expect(validateDatetime(Date.now())).toBe(false)
      expect(validateDatetime(null)).toBe(false)
    })
  })
})

// =============================================================================
// DURATION TYPE
// =============================================================================

describe('duration type', () => {
  describe('serialization (JS Duration -> SQLite TEXT ISO8601)', () => {
    it('serializes hours only', () => {
      const duration: Duration = { microseconds: BigInt(3600000000) } // 1 hour
      expect(serializeDuration(duration)).toBe('PT1H')
    })

    it('serializes minutes only', () => {
      const duration: Duration = { microseconds: BigInt(1800000000) } // 30 minutes
      expect(serializeDuration(duration)).toBe('PT30M')
    })

    it('serializes seconds only', () => {
      const duration: Duration = { microseconds: BigInt(45000000) } // 45 seconds
      expect(serializeDuration(duration)).toBe('PT45S')
    })

    it('serializes complex duration', () => {
      // 1h 30m 45.123456s
      const duration: Duration = {
        microseconds: BigInt(3600000000 + 1800000000 + 45123456)
      }
      expect(serializeDuration(duration)).toBe('PT1H30M45.123456S')
    })

    it('serializes zero duration', () => {
      const duration: Duration = { microseconds: BigInt(0) }
      expect(serializeDuration(duration)).toBe('PT0S')
    })
  })

  describe('deserialization (SQLite TEXT -> JS Duration)', () => {
    it('deserializes PT1H', () => {
      const result = deserializeDuration('PT1H')
      expect(result.microseconds).toBe(BigInt(3600000000))
    })

    it('deserializes PT30M', () => {
      const result = deserializeDuration('PT30M')
      expect(result.microseconds).toBe(BigInt(1800000000))
    })

    it('deserializes complex duration', () => {
      const result = deserializeDuration('PT1H30M45.123456S')
      expect(result.microseconds).toBe(BigInt(3600000000 + 1800000000 + 45123456))
    })

    it('throws on invalid format', () => {
      expect(() => deserializeDuration('1 hour')).toThrow(TypeError)
      expect(() => deserializeDuration('P1D')).toThrow(TypeError) // Days not allowed
    })
  })

  describe('round-trip', () => {
    it('round-trips duration', () => {
      const original: Duration = { microseconds: BigInt(5400123456) } // 1.5 hours + 123456 microseconds
      const roundTripped = deserializeDuration(serializeDuration(original))
      expect(roundTripped.microseconds).toBe(original.microseconds)
    })
  })

  describe('validation', () => {
    it('validates Duration objects', () => {
      expect(validateDuration({ microseconds: BigInt(0) })).toBe(true)
      expect(validateDuration({ microseconds: BigInt(3600000000) })).toBe(true)
    })

    it('rejects invalid Duration', () => {
      expect(validateDuration({ seconds: 10 })).toBe(false)
      expect(validateDuration(null)).toBe(false)
      expect(validateDuration('PT1H')).toBe(false)
    })
  })
})

// =============================================================================
// RELATIVE DURATION TYPE (cal::relative_duration)
// =============================================================================

describe('relative_duration type', () => {
  describe('serialization', () => {
    it('serializes months', () => {
      const duration: RelativeDuration = { months: 2, days: 0, microseconds: BigInt(0) }
      expect(serializeRelativeDuration(duration)).toBe('P2M')
    })

    it('serializes years and months', () => {
      const duration: RelativeDuration = { months: 14, days: 0, microseconds: BigInt(0) } // 1y 2m
      expect(serializeRelativeDuration(duration)).toBe('P1Y2M')
    })

    it('serializes days', () => {
      const duration: RelativeDuration = { months: 0, days: 15, microseconds: BigInt(0) }
      expect(serializeRelativeDuration(duration)).toBe('P15D')
    })

    it('serializes complex relative duration', () => {
      // 1y 2m 15d 3h 30m
      const duration: RelativeDuration = {
        months: 14,
        days: 15,
        microseconds: BigInt(3600000000 * 3 + 1800000000)
      }
      expect(serializeRelativeDuration(duration)).toBe('P1Y2M15DT3H30M')
    })

    it('serializes zero as P0D', () => {
      const duration: RelativeDuration = { months: 0, days: 0, microseconds: BigInt(0) }
      expect(serializeRelativeDuration(duration)).toBe('P0D')
    })
  })

  describe('deserialization', () => {
    it('deserializes P1Y2M', () => {
      const result = deserializeRelativeDuration('P1Y2M')
      expect(result.months).toBe(14)
      expect(result.days).toBe(0)
      expect(result.microseconds).toBe(BigInt(0))
    })

    it('deserializes P15D', () => {
      const result = deserializeRelativeDuration('P15D')
      expect(result.months).toBe(0)
      expect(result.days).toBe(15)
    })
  })

  describe('round-trip', () => {
    it('round-trips relative duration', () => {
      const original: RelativeDuration = {
        months: 14,
        days: 15,
        microseconds: BigInt(3600000000)
      }
      const roundTripped = deserializeRelativeDuration(serializeRelativeDuration(original))
      expect(roundTripped.months).toBe(original.months)
      expect(roundTripped.days).toBe(original.days)
      expect(roundTripped.microseconds).toBe(original.microseconds)
    })
  })
})

// =============================================================================
// DATE DURATION TYPE (cal::date_duration)
// =============================================================================

describe('date_duration type', () => {
  describe('serialization', () => {
    it('serializes months', () => {
      const duration: DateDuration = { months: 3, days: 0 }
      expect(serializeDateDuration(duration)).toBe('P3M')
    })

    it('serializes days', () => {
      const duration: DateDuration = { months: 0, days: 10 }
      expect(serializeDateDuration(duration)).toBe('P10D')
    })

    it('serializes years, months, and days', () => {
      const duration: DateDuration = { months: 25, days: 10 } // 2y 1m 10d
      expect(serializeDateDuration(duration)).toBe('P2Y1M10D')
    })

    it('serializes zero as P0D', () => {
      const duration: DateDuration = { months: 0, days: 0 }
      expect(serializeDateDuration(duration)).toBe('P0D')
    })
  })

  describe('deserialization', () => {
    it('deserializes P2Y1M10D', () => {
      const result = deserializeDateDuration('P2Y1M10D')
      expect(result.months).toBe(25)
      expect(result.days).toBe(10)
    })
  })

  describe('round-trip', () => {
    it('round-trips date duration', () => {
      const original: DateDuration = { months: 25, days: 10 }
      const roundTripped = deserializeDateDuration(serializeDateDuration(original))
      expect(roundTripped.months).toBe(original.months)
      expect(roundTripped.days).toBe(original.days)
    })
  })
})

// =============================================================================
// LOCAL DATE TYPE (cal::local_date)
// =============================================================================

describe('local_date type', () => {
  describe('serialization (JS LocalDate -> SQLite TEXT YYYY-MM-DD)', () => {
    it('serializes standard date', () => {
      const date: LocalDate = { year: 2024, month: 6, day: 15 }
      expect(serializeLocalDate(date)).toBe('2024-06-15')
    })

    it('pads single-digit month and day', () => {
      const date: LocalDate = { year: 2024, month: 1, day: 5 }
      expect(serializeLocalDate(date)).toBe('2024-01-05')
    })

    it('handles year before 1000', () => {
      const date: LocalDate = { year: 100, month: 12, day: 31 }
      expect(serializeLocalDate(date)).toBe('0100-12-31')
    })
  })

  describe('deserialization (SQLite TEXT -> JS LocalDate)', () => {
    it('deserializes YYYY-MM-DD format', () => {
      const result = deserializeLocalDate('2024-06-15')
      expect(result.year).toBe(2024)
      expect(result.month).toBe(6)
      expect(result.day).toBe(15)
    })
  })

  describe('round-trip', () => {
    it('round-trips local date', () => {
      const original: LocalDate = { year: 2024, month: 6, day: 15 }
      const roundTripped = deserializeLocalDate(serializeLocalDate(original))
      expect(roundTripped).toEqual(original)
    })
  })

  describe('validation', () => {
    it('validates LocalDate objects', () => {
      expect(validateLocalDate({ year: 2024, month: 6, day: 15 })).toBe(true)
    })

    it('rejects invalid months', () => {
      expect(validateLocalDate({ year: 2024, month: 0, day: 15 })).toBe(false)
      expect(validateLocalDate({ year: 2024, month: 13, day: 15 })).toBe(false)
    })

    it('rejects invalid days', () => {
      expect(validateLocalDate({ year: 2024, month: 6, day: 0 })).toBe(false)
      expect(validateLocalDate({ year: 2024, month: 6, day: 32 })).toBe(false)
    })

    it('rejects non-object', () => {
      expect(validateLocalDate('2024-06-15')).toBe(false)
      expect(validateLocalDate(null)).toBe(false)
    })
  })
})

// =============================================================================
// LOCAL TIME TYPE (cal::local_time)
// =============================================================================

describe('local_time type', () => {
  describe('serialization (JS LocalTime -> SQLite TEXT HH:MM:SS.ssssss)', () => {
    it('serializes time without fractional seconds', () => {
      const time: LocalTime = { hour: 14, minute: 30, second: 45, nanosecond: 0 }
      expect(serializeLocalTime(time)).toBe('14:30:45')
    })

    it('serializes time with microseconds', () => {
      const time: LocalTime = { hour: 14, minute: 30, second: 45, nanosecond: 123456000 }
      expect(serializeLocalTime(time)).toBe('14:30:45.123456')
    })

    it('pads single-digit values', () => {
      const time: LocalTime = { hour: 9, minute: 5, second: 3, nanosecond: 0 }
      expect(serializeLocalTime(time)).toBe('09:05:03')
    })
  })

  describe('deserialization (SQLite TEXT -> JS LocalTime)', () => {
    it('deserializes HH:MM:SS', () => {
      const result = deserializeLocalTime('14:30:45')
      expect(result.hour).toBe(14)
      expect(result.minute).toBe(30)
      expect(result.second).toBe(45)
      expect(result.nanosecond).toBe(0)
    })

    it('deserializes HH:MM:SS.ssssss', () => {
      const result = deserializeLocalTime('14:30:45.123456')
      expect(result.hour).toBe(14)
      expect(result.minute).toBe(30)
      expect(result.second).toBe(45)
      expect(result.nanosecond).toBe(123456000)
    })
  })

  describe('round-trip', () => {
    it('round-trips local time with microseconds', () => {
      const original: LocalTime = { hour: 14, minute: 30, second: 45, nanosecond: 123456000 }
      const roundTripped = deserializeLocalTime(serializeLocalTime(original))
      expect(roundTripped).toEqual(original)
    })
  })

  describe('validation', () => {
    it('validates LocalTime objects', () => {
      expect(validateLocalTime({ hour: 14, minute: 30, second: 45, nanosecond: 0 })).toBe(true)
      expect(validateLocalTime({ hour: 0, minute: 0, second: 0, nanosecond: 0 })).toBe(true)
      expect(validateLocalTime({ hour: 23, minute: 59, second: 59, nanosecond: 999999999 })).toBe(true)
    })

    it('rejects invalid hours', () => {
      expect(validateLocalTime({ hour: -1, minute: 0, second: 0, nanosecond: 0 })).toBe(false)
      expect(validateLocalTime({ hour: 24, minute: 0, second: 0, nanosecond: 0 })).toBe(false)
    })

    it('rejects invalid minutes', () => {
      expect(validateLocalTime({ hour: 0, minute: 60, second: 0, nanosecond: 0 })).toBe(false)
    })

    it('rejects invalid seconds', () => {
      expect(validateLocalTime({ hour: 0, minute: 0, second: 60, nanosecond: 0 })).toBe(false)
    })
  })
})

// =============================================================================
// LOCAL DATETIME TYPE (cal::local_datetime)
// =============================================================================

describe('local_datetime type', () => {
  describe('serialization (JS LocalDateTime -> SQLite TEXT ISO8601 without TZ)', () => {
    it('serializes full datetime', () => {
      const dt: LocalDateTime = {
        year: 2024, month: 6, day: 15,
        hour: 14, minute: 30, second: 45, nanosecond: 0
      }
      expect(serializeLocalDateTime(dt)).toBe('2024-06-15T14:30:45')
    })

    it('serializes with microseconds', () => {
      const dt: LocalDateTime = {
        year: 2024, month: 6, day: 15,
        hour: 14, minute: 30, second: 45, nanosecond: 123456000
      }
      expect(serializeLocalDateTime(dt)).toBe('2024-06-15T14:30:45.123456')
    })
  })

  describe('deserialization (SQLite TEXT -> JS LocalDateTime)', () => {
    it('deserializes ISO format without TZ', () => {
      const result = deserializeLocalDateTime('2024-06-15T14:30:45')
      expect(result.year).toBe(2024)
      expect(result.month).toBe(6)
      expect(result.day).toBe(15)
      expect(result.hour).toBe(14)
      expect(result.minute).toBe(30)
      expect(result.second).toBe(45)
    })
  })

  describe('round-trip', () => {
    it('round-trips local datetime', () => {
      const original: LocalDateTime = {
        year: 2024, month: 6, day: 15,
        hour: 14, minute: 30, second: 45, nanosecond: 123456000
      }
      const roundTripped = deserializeLocalDateTime(serializeLocalDateTime(original))
      expect(roundTripped).toEqual(original)
    })
  })

  describe('validation', () => {
    it('validates LocalDateTime objects', () => {
      expect(validateLocalDateTime({
        year: 2024, month: 6, day: 15,
        hour: 14, minute: 30, second: 45, nanosecond: 0
      })).toBe(true)
    })

    it('rejects invalid date component', () => {
      expect(validateLocalDateTime({
        year: 2024, month: 13, day: 15,
        hour: 14, minute: 30, second: 45, nanosecond: 0
      })).toBe(false)
    })

    it('rejects invalid time component', () => {
      expect(validateLocalDateTime({
        year: 2024, month: 6, day: 15,
        hour: 25, minute: 30, second: 45, nanosecond: 0
      })).toBe(false)
    })
  })
})

// =============================================================================
// ENUM TYPE
// =============================================================================

describe('enum type', () => {
  const statusEnum = { name: 'Status', values: ['pending', 'active', 'completed'] as const }

  describe('serialization', () => {
    it('serializes valid enum value', () => {
      expect(serializeEnum('pending', statusEnum)).toBe('pending')
      expect(serializeEnum('active', statusEnum)).toBe('active')
      expect(serializeEnum('completed', statusEnum)).toBe('completed')
    })

    it('throws on invalid enum value', () => {
      expect(() => serializeEnum('invalid', statusEnum)).toThrow(TypeError)
    })

    it('error message includes valid values', () => {
      expect(() => serializeEnum('invalid', statusEnum)).toThrow(/pending.*active.*completed/)
    })
  })

  describe('deserialization', () => {
    it('deserializes valid enum value', () => {
      expect(deserializeEnum('pending', statusEnum)).toBe('pending')
    })
  })

  describe('round-trip', () => {
    it('round-trips enum values', () => {
      for (const value of statusEnum.values) {
        expect(deserializeEnum(serializeEnum(value, statusEnum), statusEnum)).toBe(value)
      }
    })
  })

  describe('validation', () => {
    it('validates enum values', () => {
      expect(validateEnum('pending', statusEnum)).toBe(true)
      expect(validateEnum('active', statusEnum)).toBe(true)
    })

    it('rejects invalid enum values', () => {
      expect(validateEnum('invalid', statusEnum)).toBe(false)
      expect(validateEnum('', statusEnum)).toBe(false)
      expect(validateEnum(null, statusEnum)).toBe(false)
    })
  })
})

// =============================================================================
// ARRAY TYPE
// =============================================================================

describe('array type', () => {
  describe('serialization (JS T[] -> SQLite TEXT JSON)', () => {
    it('serializes empty array', () => {
      expect(serializeArray([], String)).toBe('[]')
    })

    it('serializes string array', () => {
      expect(serializeArray(['a', 'b', 'c'], String)).toBe('["a","b","c"]')
    })

    it('serializes number array', () => {
      expect(serializeArray([1, 2, 3], Number)).toBe('[1,2,3]')
    })

    it('serializes with custom serializer', () => {
      const dates = [new Date('2024-01-01'), new Date('2024-01-02')]
      const result = serializeArray(dates, (d: Date) => d.toISOString())
      expect(JSON.parse(result)).toEqual(['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'])
    })
  })

  describe('deserialization (SQLite TEXT -> JS T[])', () => {
    it('deserializes empty array', () => {
      expect(deserializeArray('[]', String)).toEqual([])
    })

    it('deserializes string array', () => {
      expect(deserializeArray('["a","b","c"]', String)).toEqual(['a', 'b', 'c'])
    })

    it('deserializes with custom deserializer', () => {
      const json = '["2024-01-01T00:00:00.000Z","2024-01-02T00:00:00.000Z"]'
      const result = deserializeArray(json, (s: string) => new Date(s))
      expect(result[0]).toBeInstanceOf(Date)
      expect(result[0].getUTCFullYear()).toBe(2024)
    })
  })

  describe('round-trip', () => {
    it('round-trips string array', () => {
      const original = ['hello', 'world', 'test']
      const serialized = serializeArray(original, String)
      const deserialized = deserializeArray(serialized, String)
      expect(deserialized).toEqual(original)
    })
  })
})

// =============================================================================
// TUPLE TYPE
// =============================================================================

describe('tuple type', () => {
  describe('serialization (JS tuple -> SQLite TEXT JSON)', () => {
    it('serializes simple tuple', () => {
      const tuple: [string, number] = ['hello', 42]
      expect(serializeTuple(tuple, [String, Number])).toBe('["hello",42]')
    })

    it('serializes mixed-type tuple', () => {
      const tuple: [string, number, boolean] = ['name', 25, true]
      expect(serializeTuple(tuple, [String, Number, Boolean])).toBe('["name",25,true]')
    })

    it('throws on length mismatch', () => {
      const tuple = ['hello']
      expect(() => serializeTuple(tuple, [String, Number])).toThrow(TypeError)
    })
  })

  describe('deserialization (SQLite TEXT -> JS tuple)', () => {
    it('deserializes simple tuple', () => {
      expect(deserializeTuple('["hello",42]', [String, Number])).toEqual(['hello', 42])
    })
  })

  describe('round-trip', () => {
    it('round-trips tuple', () => {
      const original: [string, number, boolean] = ['test', 42, true]
      const serialized = serializeTuple(original, [String, Number, Boolean])
      const deserialized = deserializeTuple(serialized, [String, Number, Boolean])
      expect(deserialized).toEqual(original)
    })
  })
})

// =============================================================================
// RANGE TYPE
// =============================================================================

describe('range type', () => {
  describe('serialization (JS Range -> SQLite TEXT JSON)', () => {
    it('serializes empty range', () => {
      const range: Range<number> = { lower: null, upper: null, inc_lower: false, inc_upper: false, empty: true }
      expect(JSON.parse(serializeRange(range, Number))).toEqual({ empty: true })
    })

    it('serializes bounded range', () => {
      const range: Range<number> = { lower: 1, upper: 10, inc_lower: true, inc_upper: false, empty: false }
      const result = JSON.parse(serializeRange(range, Number))
      expect(result).toEqual({ lower: 1, upper: 10, inc_lower: true, inc_upper: false, empty: false })
    })

    it('serializes unbounded lower', () => {
      const range: Range<number> = { lower: null, upper: 10, inc_lower: false, inc_upper: true, empty: false }
      const result = JSON.parse(serializeRange(range, Number))
      expect(result.lower).toBe(null)
      expect(result.upper).toBe(10)
    })

    it('serializes unbounded upper', () => {
      const range: Range<number> = { lower: 1, upper: null, inc_lower: true, inc_upper: false, empty: false }
      const result = JSON.parse(serializeRange(range, Number))
      expect(result.lower).toBe(1)
      expect(result.upper).toBe(null)
    })
  })

  describe('deserialization (SQLite TEXT -> JS Range)', () => {
    it('deserializes empty range', () => {
      const result = deserializeRange('{"empty":true}', Number)
      expect(result.empty).toBe(true)
    })

    it('deserializes bounded range', () => {
      const json = '{"lower":1,"upper":10,"inc_lower":true,"inc_upper":false,"empty":false}'
      const result = deserializeRange(json, Number)
      expect(result.lower).toBe(1)
      expect(result.upper).toBe(10)
      expect(result.inc_lower).toBe(true)
      expect(result.inc_upper).toBe(false)
      expect(result.empty).toBe(false)
    })
  })

  describe('round-trip', () => {
    it('round-trips number range', () => {
      const original: Range<number> = { lower: 5, upper: 15, inc_lower: true, inc_upper: true, empty: false }
      const roundTripped = deserializeRange(serializeRange(original, Number), Number)
      expect(roundTripped).toEqual(original)
    })

    it('round-trips datetime range', () => {
      const lower = new Date('2024-01-01')
      const upper = new Date('2024-12-31')
      const original: Range<Date> = { lower, upper, inc_lower: true, inc_upper: false, empty: false }

      const serialized = serializeRange(original, (d: Date) => d.toISOString())
      const deserialized = deserializeRange(serialized, (s: string) => new Date(s))

      expect(deserialized.lower!.getTime()).toBe(lower.getTime())
      expect(deserialized.upper!.getTime()).toBe(upper.getTime())
    })
  })
})

// =============================================================================
// MULTIRANGE TYPE
// =============================================================================

describe('multirange type', () => {
  describe('serialization (JS MultiRange -> SQLite TEXT JSON)', () => {
    it('serializes empty multirange', () => {
      expect(serializeMultiRange([], Number)).toBe('[]')
    })

    it('serializes single range', () => {
      const ranges: Range<number>[] = [
        { lower: 1, upper: 5, inc_lower: true, inc_upper: false, empty: false }
      ]
      const result = JSON.parse(serializeMultiRange(ranges, Number))
      expect(result).toHaveLength(1)
      expect(result[0].lower).toBe(1)
    })

    it('serializes multiple ranges', () => {
      const ranges: Range<number>[] = [
        { lower: 1, upper: 5, inc_lower: true, inc_upper: false, empty: false },
        { lower: 10, upper: 15, inc_lower: true, inc_upper: false, empty: false }
      ]
      const result = JSON.parse(serializeMultiRange(ranges, Number))
      expect(result).toHaveLength(2)
    })
  })

  describe('deserialization (SQLite TEXT -> JS MultiRange)', () => {
    it('deserializes empty multirange', () => {
      const result = deserializeMultiRange('[]', Number)
      expect(result).toEqual([])
    })

    it('deserializes multiple ranges', () => {
      const json = '[{"lower":1,"upper":5,"inc_lower":true,"inc_upper":false,"empty":false},{"lower":10,"upper":15,"inc_lower":true,"inc_upper":false,"empty":false}]'
      const result = deserializeMultiRange(json, Number)
      expect(result).toHaveLength(2)
      expect(result[0].lower).toBe(1)
      expect(result[1].lower).toBe(10)
    })
  })

  describe('round-trip', () => {
    it('round-trips multirange', () => {
      const original: Range<number>[] = [
        { lower: 1, upper: 5, inc_lower: true, inc_upper: false, empty: false },
        { lower: 10, upper: 15, inc_lower: true, inc_upper: true, empty: false }
      ]
      const roundTripped = deserializeMultiRange(serializeMultiRange(original, Number), Number)
      expect(roundTripped).toEqual(original)
    })
  })
})

// =============================================================================
// CARDINALITY ENFORCEMENT
// =============================================================================

describe('cardinality enforcement', () => {
  describe('validateRequired (One)', () => {
    it('passes for non-null values', () => {
      expect(() => validateRequired('value')).not.toThrow()
      expect(() => validateRequired(0)).not.toThrow()
      expect(() => validateRequired(false)).not.toThrow()
      expect(() => validateRequired('')).not.toThrow()
    })

    it('throws on null', () => {
      expect(() => validateRequired(null)).toThrow(CardinalityError)
    })

    it('throws on undefined', () => {
      expect(() => validateRequired(undefined)).toThrow(CardinalityError)
    })
  })

  describe('validateAtLeastOne (required multi)', () => {
    it('passes for non-empty array', () => {
      expect(() => validateAtLeastOne([1])).not.toThrow()
      expect(() => validateAtLeastOne([1, 2, 3])).not.toThrow()
    })

    it('throws on empty array', () => {
      expect(() => validateAtLeastOne([])).toThrow(CardinalityError)
    })

    it('throws on non-array', () => {
      expect(() => validateAtLeastOne(null as any)).toThrow(CardinalityError)
      expect(() => validateAtLeastOne('not array' as any)).toThrow(CardinalityError)
    })
  })

  describe('deserializeCardinality', () => {
    describe('One cardinality', () => {
      it('returns single value', () => {
        expect(deserializeCardinality(['value'], 'One')).toBe('value')
      })

      it('throws on empty', () => {
        expect(() => deserializeCardinality([], 'One')).toThrow(CardinalityError)
      })

      it('throws on multiple', () => {
        expect(() => deserializeCardinality(['a', 'b'], 'One')).toThrow(CardinalityError)
      })
    })

    describe('AtMostOne cardinality', () => {
      it('returns null on empty', () => {
        expect(deserializeCardinality([], 'AtMostOne')).toBe(null)
      })

      it('returns single value', () => {
        expect(deserializeCardinality(['value'], 'AtMostOne')).toBe('value')
      })

      it('throws on multiple', () => {
        expect(() => deserializeCardinality(['a', 'b'], 'AtMostOne')).toThrow(CardinalityError)
      })
    })

    describe('AtLeastOne cardinality', () => {
      it('throws on empty', () => {
        expect(() => deserializeCardinality([], 'AtLeastOne')).toThrow(CardinalityError)
      })

      it('returns array for single', () => {
        expect(deserializeCardinality(['value'], 'AtLeastOne')).toEqual(['value'])
      })

      it('returns array for multiple', () => {
        expect(deserializeCardinality(['a', 'b'], 'AtLeastOne')).toEqual(['a', 'b'])
      })
    })

    describe('Many cardinality', () => {
      it('returns empty array', () => {
        expect(deserializeCardinality([], 'Many')).toEqual([])
      })

      it('returns array for any count', () => {
        expect(deserializeCardinality(['a'], 'Many')).toEqual(['a'])
        expect(deserializeCardinality(['a', 'b', 'c'], 'Many')).toEqual(['a', 'b', 'c'])
      })
    })
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('edge cases', () => {
  describe('null handling', () => {
    it('optional fields accept null', () => {
      expect(serializeStr(null as any)).toBe(null)
      expect(deserializeStr(null as any)).toBe(null)
    })
  })

  describe('undefined handling', () => {
    it('throws on undefined for required fields', () => {
      expect(() => validateRequired(undefined)).toThrow(CardinalityError)
    })
  })

  describe('unicode edge cases', () => {
    it('handles zero-width characters', () => {
      const zeroWidth = 'a\u200Bb' // zero-width space
      expect(deserializeStr(serializeStr(zeroWidth))).toBe(zeroWidth)
    })

    it('handles combining characters', () => {
      const combining = 'e\u0301' // e with combining acute accent
      expect(deserializeStr(serializeStr(combining))).toBe(combining)
    })

    it('handles surrogate pairs', () => {
      const emoji = '\u{1F4A9}' // poop emoji
      expect(deserializeStr(serializeStr(emoji))).toBe(emoji)
    })
  })

  describe('numeric precision', () => {
    it('preserves int64 precision for safe integers', () => {
      const safeMax = Number.MAX_SAFE_INTEGER
      expect(deserializeInt64(serializeInt64(safeMax))).toBe(safeMax)
    })

    it('warns/handles unsafe integers appropriately', () => {
      const unsafeValue = Number.MAX_SAFE_INTEGER + 100
      const serialized = serializeInt64(unsafeValue)
      const deserialized = deserializeInt64(serialized)
      // Should either preserve precision (bigint) or be documented loss
      expect(typeof deserialized === 'bigint' || deserialized !== unsafeValue).toBe(true)
    })

    it('preserves float64 precision', () => {
      const precise = 3.141592653589793
      expect(deserializeFloat64(serializeFloat64(precise))).toBe(precise)
    })
  })

  describe('empty values', () => {
    it('handles empty string', () => {
      expect(serializeStr('')).toBe('')
      expect(deserializeStr('')).toBe('')
    })

    it('handles empty array', () => {
      expect(deserializeArray(serializeArray([], String), String)).toEqual([])
    })

    it('handles empty bytes', () => {
      const empty = new Uint8Array([])
      expect(deserializeBytes(serializeBytes(empty))).toEqual(empty)
    })
  })

  describe('boundary values', () => {
    it('handles Date at epoch', () => {
      const epoch = new Date(0)
      expect(deserializeDatetime(serializeDatetime(epoch)).getTime()).toBe(0)
    })

    it('handles Date far in future', () => {
      const future = new Date('9999-12-31T23:59:59.999Z')
      expect(deserializeDatetime(serializeDatetime(future)).getTime()).toBe(future.getTime())
    })

    it('handles maximum bigint', () => {
      const max = BigInt('9223372036854775807')
      expect(deserializeBigInt(serializeBigInt(max))).toBe(max)
    })

    it('handles minimum bigint', () => {
      const min = BigInt('-9223372036854775808')
      expect(deserializeBigInt(serializeBigInt(min))).toBe(min)
    })
  })

  describe('special float values', () => {
    it('handles NaN', () => {
      expect(Number.isNaN(deserializeFloat64(serializeFloat64(NaN)))).toBe(true)
    })

    it('handles negative zero', () => {
      const negZero = -0
      expect(Object.is(deserializeFloat64(serializeFloat64(negZero)), negZero)).toBe(true)
    })

    it('handles very small numbers', () => {
      const tiny = Number.MIN_VALUE
      expect(deserializeFloat64(serializeFloat64(tiny))).toBe(tiny)
    })
  })
})

// =============================================================================
// TYPE SAFETY (compile-time tests via TypeScript)
// =============================================================================

describe('type safety', () => {
  it('Duration has required microseconds field', () => {
    // This test verifies the Duration type interface
    const duration: Duration = { microseconds: BigInt(0) }
    expect(duration.microseconds).toBe(BigInt(0))
  })

  it('RelativeDuration has required fields', () => {
    const rd: RelativeDuration = { months: 0, days: 0, microseconds: BigInt(0) }
    expect(rd.months).toBe(0)
    expect(rd.days).toBe(0)
  })

  it('LocalDate has required fields', () => {
    const ld: LocalDate = { year: 2024, month: 6, day: 15 }
    expect(ld.year).toBe(2024)
  })

  it('Range has required fields', () => {
    const range: Range<number> = {
      lower: 1,
      upper: 10,
      inc_lower: true,
      inc_upper: false,
      empty: false
    }
    expect(range.lower).toBe(1)
  })
})
