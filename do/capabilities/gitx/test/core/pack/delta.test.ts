/**
 * @fileoverview RED Phase Tests for Git Delta Compression Algorithm
 *
 * These tests cover the Git packfile delta compression format including:
 * - Delta instruction types (copy from base, insert new data)
 * - Copy instruction encoding (offset + size, variable length)
 * - Insert instruction encoding (size + data)
 * - Delta header (base size, result size as varints)
 * - Delta application (base + delta -> result)
 * - Delta chain resolution (delta of delta)
 * - OFS_DELTA (offset to base in same pack)
 * - REF_DELTA (SHA reference to base object)
 * - Edge cases (empty delta, max copy size, large offsets)
 *
 * These tests are designed to FAIL initially (RED phase).
 * The module '../../../core/pack/delta' does not exist yet.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Delta instruction constants
  COPY_INSTRUCTION,
  INSERT_INSTRUCTION,

  // Delta header parsing
  parseDeltaHeader,
  encodeDeltaHeader,

  // Instruction encoding/decoding
  encodeCopyInstruction,
  decodeCopyInstruction,
  encodeInsertInstruction,
  decodeInsertInstruction,

  // Delta application
  applyDelta,
  applyDeltaChain,

  // Delta creation
  createDelta,

  // Pack delta types
  OFS_DELTA,
  REF_DELTA,
  encodeOfsDelta,
  decodeOfsDelta,
  encodeRefDelta,
  decodeRefDelta,

  // Types
  type DeltaInstruction,
  type CopyInstruction,
  type InsertInstruction,
  type DeltaHeader,
  type OfsDeltaHeader,
  type RefDeltaHeader,
} from '../../../core/pack/delta'

// =============================================================================
// Helper Functions
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// =============================================================================
// 1. Delta Instruction Types Tests
// =============================================================================

describe('Delta Instruction Types', () => {
  describe('Instruction type constants', () => {
    it('should define COPY_INSTRUCTION as 0x80 (MSB set)', () => {
      expect(COPY_INSTRUCTION).toBe(0x80)
    })

    it('should define INSERT_INSTRUCTION as 0x00 (MSB clear)', () => {
      expect(INSERT_INSTRUCTION).toBe(0x00)
    })

    it('should correctly identify copy instructions by MSB', () => {
      // Any byte with MSB set is a copy instruction
      for (let i = 0x80; i <= 0xff; i++) {
        expect((i & COPY_INSTRUCTION) !== 0).toBe(true)
      }
    })

    it('should correctly identify insert instructions by MSB', () => {
      // Any byte with MSB clear (except 0) is an insert instruction
      for (let i = 0x01; i <= 0x7f; i++) {
        expect((i & COPY_INSTRUCTION) === 0).toBe(true)
      }
    })

    it('should treat 0x00 as reserved/invalid instruction', () => {
      // 0x00 is not a valid instruction byte
      expect(() => {
        const delta = new Uint8Array([0x00, 0x00, 0x00]) // invalid
        applyDelta(new Uint8Array(0), delta)
      }).toThrow(/invalid/i)
    })
  })

  describe('Copy instruction identification', () => {
    it('should recognize 0x80 as minimal copy (no offset, no size bytes)', () => {
      // 0x80 = copy with size 0x10000 from offset 0
      const cmd = 0x80
      expect(cmd & COPY_INSTRUCTION).toBe(0x80)
      expect(cmd & 0x0f).toBe(0) // no offset bytes
      expect(cmd & 0x70).toBe(0) // no size bytes
    })

    it('should recognize 0x91 as copy with offset byte 1 and size byte 1', () => {
      // 0x91 = 0x80 | 0x01 | 0x10
      const cmd = 0x91
      expect(cmd & COPY_INSTRUCTION).toBe(0x80)
      expect(cmd & 0x01).toBe(0x01) // offset byte 1 present
      expect(cmd & 0x10).toBe(0x10) // size byte 1 present
    })

    it('should recognize 0xff as copy with all offset and size bytes', () => {
      // 0xff = all bits set (4 offset bytes, 3 size bytes)
      const cmd = 0xff
      expect(cmd & 0x0f).toBe(0x0f) // all 4 offset bytes
      expect(cmd & 0x70).toBe(0x70) // all 3 size bytes
    })
  })

  describe('Insert instruction identification', () => {
    it('should recognize 0x01 as insert 1 byte', () => {
      const cmd = 0x01
      expect(cmd & COPY_INSTRUCTION).toBe(0)
      expect(cmd & 0x7f).toBe(1)
    })

    it('should recognize 0x7f as insert 127 bytes (maximum)', () => {
      const cmd = 0x7f
      expect(cmd & COPY_INSTRUCTION).toBe(0)
      expect(cmd & 0x7f).toBe(127)
    })
  })
})

// =============================================================================
// 2. Copy Instruction Encoding Tests
// =============================================================================

describe('Copy Instruction Encoding', () => {
  describe('encodeCopyInstruction', () => {
    it('should encode copy with zero offset and default size', () => {
      // Copy from offset 0, size 0x10000 (encoded as no size bytes)
      const encoded = encodeCopyInstruction(0, 0x10000)
      expect(encoded[0]).toBe(0x80) // just copy marker, no offset/size bytes
      expect(encoded.length).toBe(1)
    })

    it('should encode copy with 1-byte offset', () => {
      // Offset 0x42, size 16
      const encoded = encodeCopyInstruction(0x42, 16)
      expect(encoded[0] & 0x01).toBe(0x01) // offset byte 1 present
      expect(encoded[1]).toBe(0x42)
    })

    it('should encode copy with 2-byte offset', () => {
      // Offset 0x1234, size 32
      const encoded = encodeCopyInstruction(0x1234, 32)
      expect(encoded[0] & 0x03).toBe(0x03) // offset bytes 1 & 2 present
      expect(encoded[1]).toBe(0x34) // little-endian low byte
      expect(encoded[2]).toBe(0x12) // little-endian high byte
    })

    it('should encode copy with 3-byte offset', () => {
      // Offset 0x123456, size 64
      const encoded = encodeCopyInstruction(0x123456, 64)
      expect(encoded[0] & 0x07).toBe(0x07) // offset bytes 1, 2 & 3 present
      expect(encoded[1]).toBe(0x56)
      expect(encoded[2]).toBe(0x34)
      expect(encoded[3]).toBe(0x12)
    })

    it('should encode copy with 4-byte offset', () => {
      // Offset 0x12345678, size 128
      const encoded = encodeCopyInstruction(0x12345678, 128)
      expect(encoded[0] & 0x0f).toBe(0x0f) // all 4 offset bytes present
      expect(encoded[1]).toBe(0x78)
      expect(encoded[2]).toBe(0x56)
      expect(encoded[3]).toBe(0x34)
      expect(encoded[4]).toBe(0x12)
    })

    it('should encode copy with 1-byte size', () => {
      // Offset 0, size 0x42
      const encoded = encodeCopyInstruction(0, 0x42)
      expect(encoded[0] & 0x10).toBe(0x10) // size byte 1 present
      // Find the size byte (after any offset bytes)
      const offsetBytes = (encoded[0] & 0x0f).toString(2).split('1').length - 1
      expect(encoded[1 + offsetBytes]).toBe(0x42)
    })

    it('should encode copy with 2-byte size', () => {
      // Offset 0, size 0x1234
      const encoded = encodeCopyInstruction(0, 0x1234)
      expect(encoded[0] & 0x30).toBe(0x30) // size bytes 1 & 2 present
    })

    it('should encode copy with 3-byte size', () => {
      // Offset 0, size 0x123456
      const encoded = encodeCopyInstruction(0, 0x123456)
      expect(encoded[0] & 0x70).toBe(0x70) // size bytes 1, 2 & 3 present
    })

    it('should encode copy with sparse offset bytes (e.g., 0x00010000)', () => {
      // Offset where only byte 3 is non-zero
      const encoded = encodeCopyInstruction(0x00010000, 16)
      // Only bit 2 (0x04) should be set for offset
      expect(encoded[0] & 0x0f).toBe(0x04)
      expect(encoded[1]).toBe(0x01) // the 0x01 at position 2
    })

    it('should encode copy with sparse size bytes (e.g., 0x000100)', () => {
      // Size where only byte 2 is non-zero
      const encoded = encodeCopyInstruction(0, 0x000100)
      // Only bit 5 (0x20) should be set for size
      expect(encoded[0] & 0x70).toBe(0x20)
    })
  })

  describe('decodeCopyInstruction', () => {
    it('should decode minimal copy instruction (0x80)', () => {
      const data = new Uint8Array([0x80])
      const result = decodeCopyInstruction(data, 0)
      expect(result.offset).toBe(0)
      expect(result.size).toBe(0x10000) // default when no size bytes
      expect(result.bytesRead).toBe(1)
    })

    it('should decode copy with 1-byte offset', () => {
      const data = new Uint8Array([0x91, 0x42, 0x10]) // offset 0x42, size 0x10
      const result = decodeCopyInstruction(data, 0)
      expect(result.offset).toBe(0x42)
      expect(result.size).toBe(0x10)
    })

    it('should decode copy with 4-byte offset and 3-byte size', () => {
      // Full instruction: all offset and size bytes
      const data = new Uint8Array([
        0xff,                   // all offset and size bytes present
        0x78, 0x56, 0x34, 0x12, // offset 0x12345678 in little-endian
        0x56, 0x34, 0x12        // size 0x123456 in little-endian
      ])
      const result = decodeCopyInstruction(data, 0)
      expect(result.offset).toBe(0x12345678)
      expect(result.size).toBe(0x123456)
      expect(result.bytesRead).toBe(8)
    })

    it('should decode from non-zero offset in buffer', () => {
      const data = new Uint8Array([0xaa, 0xbb, 0x91, 0x06, 0x05])
      const result = decodeCopyInstruction(data, 2)
      expect(result.offset).toBe(6)
      expect(result.size).toBe(5)
    })

    it('should round-trip encode/decode', () => {
      const testCases = [
        { offset: 0, size: 0x10000 },
        { offset: 0, size: 5 },
        { offset: 100, size: 50 },
        { offset: 0x1234, size: 0x5678 },
        { offset: 0x12345678, size: 0x123456 },
        { offset: 0x00010000, size: 0x000100 },
      ]

      for (const { offset, size } of testCases) {
        const encoded = encodeCopyInstruction(offset, size)
        const decoded = decodeCopyInstruction(encoded, 0)
        expect(decoded.offset).toBe(offset)
        expect(decoded.size).toBe(size)
      }
    })
  })
})

// =============================================================================
// 3. Insert Instruction Encoding Tests
// =============================================================================

describe('Insert Instruction Encoding', () => {
  describe('encodeInsertInstruction', () => {
    it('should encode single byte insert', () => {
      const data = new Uint8Array([0x42])
      const encoded = encodeInsertInstruction(data)
      expect(encoded[0]).toBe(1) // length byte
      expect(encoded[1]).toBe(0x42) // data byte
      expect(encoded.length).toBe(2)
    })

    it('should encode maximum single insert (127 bytes)', () => {
      const data = new Uint8Array(127).fill(0xab)
      const encoded = encodeInsertInstruction(data)
      expect(encoded[0]).toBe(127) // length byte
      expect(encoded.length).toBe(128) // 1 + 127
      expect(encoded.subarray(1)).toEqual(data)
    })

    it('should split insert larger than 127 bytes into multiple instructions', () => {
      const data = new Uint8Array(200).fill(0xcd)
      const encoded = encodeInsertInstruction(data)
      // First instruction: 127 bytes
      expect(encoded[0]).toBe(127)
      // Second instruction at offset 128: 73 bytes
      expect(encoded[128]).toBe(73)
      expect(encoded.length).toBe(2 + 200) // 2 length bytes + 200 data bytes
    })

    it('should reject empty data', () => {
      const data = new Uint8Array(0)
      expect(() => encodeInsertInstruction(data)).toThrow()
    })
  })

  describe('decodeInsertInstruction', () => {
    it('should decode single byte insert', () => {
      const data = new Uint8Array([0x01, 0x42])
      const result = decodeInsertInstruction(data, 0)
      expect(result.size).toBe(1)
      expect(result.data).toEqual(new Uint8Array([0x42]))
      expect(result.bytesRead).toBe(2)
    })

    it('should decode maximum insert (127 bytes)', () => {
      const insertData = new Uint8Array(127).fill(0xef)
      const data = concatBytes(new Uint8Array([127]), insertData)
      const result = decodeInsertInstruction(data, 0)
      expect(result.size).toBe(127)
      expect(result.data).toEqual(insertData)
      expect(result.bytesRead).toBe(128)
    })

    it('should decode from non-zero offset', () => {
      const data = new Uint8Array([0xaa, 0xbb, 0x03, 0x01, 0x02, 0x03])
      const result = decodeInsertInstruction(data, 2)
      expect(result.size).toBe(3)
      expect(result.data).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
    })

    it('should throw if not enough data for declared size', () => {
      const data = new Uint8Array([0x10, 0x01, 0x02]) // claims 16 bytes but only has 2
      expect(() => decodeInsertInstruction(data, 0)).toThrow()
    })
  })
})

// =============================================================================
// 4. Delta Header Tests (Base Size, Result Size as Varints)
// =============================================================================

describe('Delta Header Encoding', () => {
  describe('parseDeltaHeader (varint decoding)', () => {
    it('should parse single-byte size (0-127)', () => {
      const data = new Uint8Array([0x00])
      expect(parseDeltaHeader(data, 0).size).toBe(0)

      const data2 = new Uint8Array([0x7f])
      expect(parseDeltaHeader(data2, 0).size).toBe(127)
    })

    it('should parse two-byte size (128-16383)', () => {
      // 128 = 0x80 -> encoded as 0x80, 0x01
      const data = new Uint8Array([0x80, 0x01])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(128)
      expect(result.bytesRead).toBe(2)
    })

    it('should parse three-byte size', () => {
      // 20000 = 0x4e20
      // Varint encoding: (20000 & 0x7f) | 0x80 = 0xa0, then (20000 >> 7) & 0x7f | 0x80 = 0x9c, then 0x01
      const data = new Uint8Array([0xa0, 0x9c, 0x01])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(20000)
      expect(result.bytesRead).toBe(3)
    })

    it('should parse from non-zero offset', () => {
      const data = new Uint8Array([0xff, 0xff, 0x0a])
      const result = parseDeltaHeader(data, 2)
      expect(result.size).toBe(10)
      expect(result.bytesRead).toBe(1)
    })

    it('should throw on truncated varint', () => {
      // Continuation bit set but no more bytes
      const data = new Uint8Array([0x80])
      expect(() => parseDeltaHeader(data, 0)).toThrow()
    })

    it('should throw on excessively long varint (corrupted data)', () => {
      // All bytes have continuation bit - would loop forever
      const data = new Uint8Array(20).fill(0x80)
      expect(() => parseDeltaHeader(data, 0)).toThrow()
    })
  })

  describe('encodeDeltaHeader (varint encoding)', () => {
    it('should encode single-byte sizes (0-127)', () => {
      expect(encodeDeltaHeader(0)).toEqual(new Uint8Array([0x00]))
      expect(encodeDeltaHeader(1)).toEqual(new Uint8Array([0x01]))
      expect(encodeDeltaHeader(127)).toEqual(new Uint8Array([0x7f]))
    })

    it('should encode two-byte sizes (128-16383)', () => {
      const encoded = encodeDeltaHeader(128)
      expect(encoded).toEqual(new Uint8Array([0x80, 0x01]))

      const encoded2 = encodeDeltaHeader(16383)
      expect(encoded2).toEqual(new Uint8Array([0xff, 0x7f]))
    })

    it('should encode large sizes', () => {
      const encoded = encodeDeltaHeader(1000000)
      expect(encoded.length).toBeGreaterThan(2)

      // Round-trip verify
      const decoded = parseDeltaHeader(encoded, 0)
      expect(decoded.size).toBe(1000000)
    })

    it('should round-trip encode/decode', () => {
      const testValues = [0, 1, 127, 128, 255, 16383, 16384, 2097151, 268435455]
      for (const value of testValues) {
        const encoded = encodeDeltaHeader(value)
        const decoded = parseDeltaHeader(encoded, 0)
        expect(decoded.size).toBe(value)
      }
    })
  })

  describe('Full delta header (source + target size)', () => {
    it('should parse both source and target size', () => {
      // Source size: 100, Target size: 150
      const sourceHeader = encodeDeltaHeader(100)
      const targetHeader = encodeDeltaHeader(150)
      const data = concatBytes(sourceHeader, targetHeader)

      let offset = 0
      const source = parseDeltaHeader(data, offset)
      offset += source.bytesRead
      const target = parseDeltaHeader(data, offset)

      expect(source.size).toBe(100)
      expect(target.size).toBe(150)
    })
  })
})

// =============================================================================
// 5. Delta Application Tests (Base + Delta -> Result)
// =============================================================================

describe('Delta Application', () => {
  describe('applyDelta basic operations', () => {
    it('should apply insert-only delta to empty base', () => {
      const base = new Uint8Array(0)
      const delta = concatBytes(
        encodeDeltaHeader(0),      // source size = 0
        encodeDeltaHeader(5),      // target size = 5
        new Uint8Array([0x05]),    // insert 5 bytes
        encoder.encode('hello')
      )
      const result = applyDelta(base, delta)
      expect(decoder.decode(result)).toBe('hello')
    })

    it('should apply copy-only delta (identity)', () => {
      const base = encoder.encode('hello')
      const delta = concatBytes(
        encodeDeltaHeader(5),      // source size = 5
        encodeDeltaHeader(5),      // target size = 5
        new Uint8Array([0x90, 0x05]) // copy offset=0, size=5
      )
      const result = applyDelta(base, delta)
      expect(result).toEqual(base)
    })

    it('should apply copy with non-zero offset', () => {
      const base = encoder.encode('hello world')
      const delta = concatBytes(
        encodeDeltaHeader(11),     // source size = 11
        encodeDeltaHeader(5),      // target size = 5
        new Uint8Array([0x91, 0x06, 0x05]) // copy offset=6, size=5
      )
      const result = applyDelta(base, delta)
      expect(decoder.decode(result)).toBe('world')
    })

    it('should apply mixed copy and insert', () => {
      const base = encoder.encode('hello')
      // Target: "hi hello there"
      const delta = concatBytes(
        encodeDeltaHeader(5),      // source size = 5
        encodeDeltaHeader(14),     // target size = 14
        new Uint8Array([0x03]),    // insert 3 bytes
        encoder.encode('hi '),
        new Uint8Array([0x90, 0x05]), // copy 5 bytes from offset 0
        new Uint8Array([0x06]),    // insert 6 bytes
        encoder.encode(' there')
      )
      const result = applyDelta(base, delta)
      expect(decoder.decode(result)).toBe('hi hello there')
    })

    it('should apply delta with multiple copies', () => {
      const base = encoder.encode('abcdefghij')
      // Target: copy first 3, copy last 3
      const delta = concatBytes(
        encodeDeltaHeader(10),     // source size = 10
        encodeDeltaHeader(6),      // target size = 6
        new Uint8Array([0x90, 0x03]), // copy offset=0, size=3 (abc)
        new Uint8Array([0x91, 0x07, 0x03]) // copy offset=7, size=3 (hij)
      )
      const result = applyDelta(base, delta)
      expect(decoder.decode(result)).toBe('abchij')
    })
  })

  describe('applyDelta error handling', () => {
    it('should throw on source size mismatch', () => {
      const base = new Uint8Array([1, 2, 3])
      const delta = concatBytes(
        encodeDeltaHeader(10),     // claims base is 10 bytes
        encodeDeltaHeader(3),
        new Uint8Array([0x90, 0x03])
      )
      expect(() => applyDelta(base, delta)).toThrow(/size.*mismatch/i)
    })

    it('should throw on target size mismatch', () => {
      const base = new Uint8Array([1, 2, 3])
      const delta = concatBytes(
        encodeDeltaHeader(3),
        encodeDeltaHeader(10),     // claims result is 10 bytes
        new Uint8Array([0x90, 0x03]) // but only copies 3
      )
      expect(() => applyDelta(base, delta)).toThrow(/size.*mismatch/i)
    })

    it('should throw on copy out of bounds', () => {
      const base = new Uint8Array([1, 2, 3])
      const delta = concatBytes(
        encodeDeltaHeader(3),
        encodeDeltaHeader(5),
        new Uint8Array([0x91, 0x02, 0x05]) // copy from offset 2, size 5 (exceeds base)
      )
      expect(() => applyDelta(base, delta)).toThrow(/bounds/i)
    })

    it('should throw on invalid instruction byte (0x00)', () => {
      const base = new Uint8Array([1, 2, 3])
      const delta = concatBytes(
        encodeDeltaHeader(3),
        encodeDeltaHeader(3),
        new Uint8Array([0x00]) // invalid
      )
      expect(() => applyDelta(base, delta)).toThrow(/invalid/i)
    })

    it('should throw on truncated insert data', () => {
      const base = new Uint8Array(0)
      const delta = concatBytes(
        encodeDeltaHeader(0),
        encodeDeltaHeader(10),
        new Uint8Array([0x0a, 0x01, 0x02]) // claims 10 bytes but only has 2
      )
      expect(() => applyDelta(base, delta)).toThrow()
    })
  })

  describe('applyDelta with large offsets and sizes', () => {
    it('should handle 2-byte offset', () => {
      const base = new Uint8Array(300)
      base.fill(0x41)
      base[256] = 0x42
      base[257] = 0x43

      const delta = concatBytes(
        encodeDeltaHeader(300),
        encodeDeltaHeader(2),
        new Uint8Array([0x93, 0x00, 0x01, 0x02]) // offset 0x0100, size 2
      )
      const result = applyDelta(base, delta)
      expect(result).toEqual(new Uint8Array([0x42, 0x43]))
    })

    it('should handle 3-byte offset', () => {
      const baseSize = 0x20000 // 128KB
      const base = new Uint8Array(baseSize)
      base.fill(0x41)
      base[0x10000] = 0x42
      base[0x10001] = 0x43

      const delta = concatBytes(
        encodeDeltaHeader(baseSize),
        encodeDeltaHeader(2),
        new Uint8Array([0x97, 0x00, 0x00, 0x01, 0x02]) // offset 0x010000, size 2
      )
      const result = applyDelta(base, delta)
      expect(result).toEqual(new Uint8Array([0x42, 0x43]))
    })

    it('should handle implicit size 0x10000', () => {
      const base = new Uint8Array(0x10000)
      base.fill(0x41)

      const delta = concatBytes(
        encodeDeltaHeader(0x10000),
        encodeDeltaHeader(0x10000),
        new Uint8Array([0x80]) // copy with no size bytes = 0x10000
      )
      const result = applyDelta(base, delta)
      expect(result.length).toBe(0x10000)
      expect(result).toEqual(base)
    })

    it('should handle 4-byte offset', () => {
      // Conceptual test with 4-byte offset encoding
      const base = new Uint8Array(16)
      base.fill(0x41)

      const delta = concatBytes(
        encodeDeltaHeader(16),
        encodeDeltaHeader(5),
        new Uint8Array([
          0x9f,                      // all offset bytes + size byte 1
          0x00, 0x00, 0x00, 0x00,    // offset = 0
          0x05                       // size = 5
        ])
      )
      const result = applyDelta(base, delta)
      expect(result.length).toBe(5)
    })
  })
})

// =============================================================================
// 6. Delta Chain Resolution Tests (Delta of Delta)
// =============================================================================

describe('Delta Chain Resolution', () => {
  describe('applyDeltaChain', () => {
    it('should resolve single delta chain (depth 1)', () => {
      const base = encoder.encode('hello')
      const delta1 = createDelta(base, encoder.encode('hello world'))

      const result = applyDeltaChain(base, [delta1])
      expect(decoder.decode(result)).toBe('hello world')
    })

    it('should resolve delta chain of depth 2', () => {
      const base = encoder.encode('hello')
      const intermediate = encoder.encode('hello world')
      const target = encoder.encode('hello world!')

      const delta1 = createDelta(base, intermediate)
      const delta2 = createDelta(intermediate, target)

      const result = applyDeltaChain(base, [delta1, delta2])
      expect(decoder.decode(result)).toBe('hello world!')
    })

    it('should resolve delta chain of depth 3', () => {
      const v0 = encoder.encode('a')
      const v1 = encoder.encode('ab')
      const v2 = encoder.encode('abc')
      const v3 = encoder.encode('abcd')

      const deltas = [
        createDelta(v0, v1),
        createDelta(v1, v2),
        createDelta(v2, v3),
      ]

      const result = applyDeltaChain(v0, deltas)
      expect(decoder.decode(result)).toBe('abcd')
    })

    it('should handle empty delta chain', () => {
      const base = encoder.encode('hello')
      const result = applyDeltaChain(base, [])
      expect(result).toEqual(base)
    })

    it('should handle deep delta chain (depth 10)', () => {
      let current = encoder.encode('start')
      const deltas: Uint8Array[] = []

      for (let i = 0; i < 10; i++) {
        const next = encoder.encode(`start${'-'.repeat(i + 1)}end`)
        deltas.push(createDelta(current, next))
        current = next
      }

      const result = applyDeltaChain(encoder.encode('start'), deltas)
      expect(decoder.decode(result)).toBe('start----------end')
    })
  })
})

// =============================================================================
// 7. OFS_DELTA Tests (Offset to Base in Same Pack)
// =============================================================================

describe('OFS_DELTA Encoding', () => {
  describe('OFS_DELTA constant', () => {
    it('should define OFS_DELTA as type 6', () => {
      expect(OFS_DELTA).toBe(6)
    })
  })

  describe('encodeOfsDelta', () => {
    it('should encode small offset (1 byte)', () => {
      // Offset 10 fits in 7 bits
      const encoded = encodeOfsDelta(10)
      expect(encoded.length).toBe(1)
      expect(encoded[0]).toBe(10)
    })

    it('should encode medium offset (2 bytes)', () => {
      // Offset 1000 requires 2 bytes
      const encoded = encodeOfsDelta(1000)
      expect(encoded.length).toBe(2)
    })

    it('should encode large offset (multiple bytes)', () => {
      // Offset 100000 requires multiple bytes
      const encoded = encodeOfsDelta(100000)
      expect(encoded.length).toBeGreaterThan(2)
    })

    it('should use Git negative offset encoding', () => {
      // OFS_DELTA uses a special encoding where each byte's MSB indicates continuation
      // and values are accumulated with (n+1) << 7 + next
      const encoded = encodeOfsDelta(128)
      // First byte has MSB set, second byte doesn't
      expect(encoded[0] & 0x80).toBe(0x80)
      expect(encoded[encoded.length - 1] & 0x80).toBe(0)
    })
  })

  describe('decodeOfsDelta', () => {
    it('should decode small offset', () => {
      const data = new Uint8Array([10])
      const result = decodeOfsDelta(data, 0)
      expect(result.offset).toBe(10)
      expect(result.bytesRead).toBe(1)
    })

    it('should decode medium offset', () => {
      const encoded = encodeOfsDelta(1000)
      const result = decodeOfsDelta(encoded, 0)
      expect(result.offset).toBe(1000)
    })

    it('should decode large offset', () => {
      const encoded = encodeOfsDelta(100000)
      const result = decodeOfsDelta(encoded, 0)
      expect(result.offset).toBe(100000)
    })

    it('should round-trip encode/decode', () => {
      const testOffsets = [1, 10, 100, 1000, 10000, 100000, 1000000]
      for (const offset of testOffsets) {
        const encoded = encodeOfsDelta(offset)
        const decoded = decodeOfsDelta(encoded, 0)
        expect(decoded.offset).toBe(offset)
      }
    })

    it('should decode from non-zero position', () => {
      const encoded = encodeOfsDelta(500)
      const data = concatBytes(new Uint8Array([0xaa, 0xbb]), encoded)
      const result = decodeOfsDelta(data, 2)
      expect(result.offset).toBe(500)
    })
  })
})

// =============================================================================
// 8. REF_DELTA Tests (SHA Reference to Base Object)
// =============================================================================

describe('REF_DELTA Encoding', () => {
  describe('REF_DELTA constant', () => {
    it('should define REF_DELTA as type 7', () => {
      expect(REF_DELTA).toBe(7)
    })
  })

  describe('encodeRefDelta', () => {
    it('should encode 20-byte SHA-1 reference', () => {
      const sha = hexToBytes('da39a3ee5e6b4b0d3255bfef95601890afd80709')
      const encoded = encodeRefDelta(sha)
      expect(encoded.length).toBe(20)
      expect(encoded).toEqual(sha)
    })

    it('should reject invalid SHA length', () => {
      const shortSha = new Uint8Array(19)
      expect(() => encodeRefDelta(shortSha)).toThrow(/20 bytes/i)

      const longSha = new Uint8Array(21)
      expect(() => encodeRefDelta(longSha)).toThrow(/20 bytes/i)
    })

    it('should encode 32-byte SHA-256 reference (v3 packs)', () => {
      // Future Git pack format may use SHA-256
      const sha256 = new Uint8Array(32).fill(0xab)
      const encoded = encodeRefDelta(sha256, 'sha256')
      expect(encoded.length).toBe(32)
    })
  })

  describe('decodeRefDelta', () => {
    it('should decode 20-byte SHA-1 reference', () => {
      const sha = hexToBytes('da39a3ee5e6b4b0d3255bfef95601890afd80709')
      const result = decodeRefDelta(sha, 0)
      expect(result.sha).toEqual(sha)
      expect(result.bytesRead).toBe(20)
    })

    it('should decode from non-zero position', () => {
      const sha = hexToBytes('0123456789abcdef0123456789abcdef01234567')
      const data = concatBytes(new Uint8Array([0xaa, 0xbb, 0xcc]), sha)
      const result = decodeRefDelta(data, 3)
      expect(result.sha).toEqual(sha)
      expect(result.bytesRead).toBe(20)
    })

    it('should throw if not enough bytes', () => {
      const data = new Uint8Array(10)
      expect(() => decodeRefDelta(data, 0)).toThrow()
    })

    it('should return SHA as hex string when requested', () => {
      const sha = hexToBytes('da39a3ee5e6b4b0d3255bfef95601890afd80709')
      const result = decodeRefDelta(sha, 0, { asHex: true })
      expect(result.shaHex).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    })
  })
})

// =============================================================================
// 9. Edge Cases Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('Empty delta', () => {
    it('should create delta for empty base and empty target', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array(0)
      const delta = createDelta(base, target)

      // Delta should just have two size headers (both 0)
      expect(delta.length).toBe(2)
      expect(delta[0]).toBe(0)
      expect(delta[1]).toBe(0)
    })

    it('should apply empty delta to empty base', () => {
      const base = new Uint8Array(0)
      const delta = concatBytes(
        encodeDeltaHeader(0),
        encodeDeltaHeader(0)
      )
      const result = applyDelta(base, delta)
      expect(result.length).toBe(0)
    })

    it('should create delta from empty base to non-empty target', () => {
      const base = new Uint8Array(0)
      const target = encoder.encode('hello')
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta from non-empty base to empty target', () => {
      const base = encoder.encode('hello')
      const target = new Uint8Array(0)
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result.length).toBe(0)
    })
  })

  describe('Maximum copy size', () => {
    it('should handle copy of exactly 0x10000 bytes', () => {
      const base = new Uint8Array(0x10000).fill(0x42)
      const delta = concatBytes(
        encodeDeltaHeader(0x10000),
        encodeDeltaHeader(0x10000),
        new Uint8Array([0x80]) // copy with no size = 0x10000
      )
      const result = applyDelta(base, delta)
      expect(result.length).toBe(0x10000)
    })

    it('should handle copy of 0x10001 bytes (requires explicit size)', () => {
      const copySize = 0x10001
      const base = new Uint8Array(copySize).fill(0x42)

      const delta = concatBytes(
        encodeDeltaHeader(copySize),
        encodeDeltaHeader(copySize),
        encodeCopyInstruction(0, copySize)
      )
      const result = applyDelta(base, delta)
      expect(result.length).toBe(copySize)
    })

    it('should handle maximum 3-byte copy size (0xffffff = 16777215)', () => {
      // This is a conceptual test - we just verify encoding works
      const maxSize = 0xffffff
      const encoded = encodeCopyInstruction(0, maxSize)
      const decoded = decodeCopyInstruction(encoded, 0)
      expect(decoded.size).toBe(maxSize)
    })
  })

  describe('Large offsets', () => {
    it('should handle maximum 4-byte offset (0xffffffff)', () => {
      const maxOffset = 0xffffffff
      const encoded = encodeCopyInstruction(maxOffset, 1)
      const decoded = decodeCopyInstruction(encoded, 0)
      expect(decoded.offset).toBe(maxOffset)
    })

    it('should handle offset at 2GB boundary', () => {
      const offset = 0x80000000 // 2GB
      const encoded = encodeCopyInstruction(offset, 10)
      const decoded = decodeCopyInstruction(encoded, 0)
      expect(decoded.offset).toBe(offset)
    })
  })

  describe('Single byte objects', () => {
    it('should create and apply delta for single byte change', () => {
      const base = new Uint8Array([0x41])
      const target = new Uint8Array([0x42])
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create identity delta for identical single byte', () => {
      const base = new Uint8Array([0x41])
      const delta = createDelta(base, base)
      const result = applyDelta(base, delta)
      expect(result).toEqual(base)
    })
  })

  describe('Binary data with null bytes', () => {
    it('should handle data with embedded nulls', () => {
      const base = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00])
      const target = new Uint8Array([0x00, 0x01, 0x00, 0x03, 0x00])
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle all-null data', () => {
      const base = new Uint8Array(100).fill(0x00)
      const target = new Uint8Array(100).fill(0x00)
      target[50] = 0x01
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })
  })

  describe('Maximum insert size boundary', () => {
    it('should handle insert of exactly 127 bytes', () => {
      const data = new Uint8Array(127).fill(0xab)
      const encoded = encodeInsertInstruction(data)
      expect(encoded[0]).toBe(127)
    })

    it('should handle insert of 128 bytes (requires split)', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array(128).fill(0xcd)
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle insert of 255 bytes (requires 2 instructions)', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array(255).fill(0xef)
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })
  })

  describe('Pathological cases', () => {
    it('should handle completely different large objects', () => {
      const base = new Uint8Array(10000)
      for (let i = 0; i < base.length; i++) base[i] = i % 256

      const target = new Uint8Array(10000)
      for (let i = 0; i < target.length; i++) target[i] = (255 - i) % 256

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle object with repeated patterns', () => {
      const pattern = encoder.encode('ABCD')
      const base = new Uint8Array(1000)
      for (let i = 0; i < base.length; i++) {
        base[i] = pattern[i % pattern.length]
      }

      const target = new Uint8Array(base)
      target[500] = 0x00 // Single change in middle

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle delta where target is subset of base', () => {
      const base = encoder.encode('hello world!')
      const target = encoder.encode('world') // substring of base
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle delta where base is subset of target', () => {
      const base = encoder.encode('world')
      const target = encoder.encode('hello world!') // contains base
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })
  })

  describe('Varint edge cases', () => {
    it('should handle size at 7-bit boundary (127 vs 128)', () => {
      const size127 = encodeDeltaHeader(127)
      const size128 = encodeDeltaHeader(128)

      expect(size127.length).toBe(1)
      expect(size128.length).toBe(2)
    })

    it('should handle size at 14-bit boundary (16383 vs 16384)', () => {
      const size16383 = encodeDeltaHeader(16383)
      const size16384 = encodeDeltaHeader(16384)

      expect(size16383.length).toBe(2)
      expect(size16384.length).toBe(3)
    })

    it('should handle maximum safe integer size', () => {
      // JavaScript safe integer limit
      const maxSafe = Number.MAX_SAFE_INTEGER
      const encoded = encodeDeltaHeader(maxSafe)
      const decoded = parseDeltaHeader(encoded, 0)
      expect(decoded.size).toBe(maxSafe)
    })
  })

  describe('Copy instruction edge cases', () => {
    it('should handle copy with offset 0 and various sizes', () => {
      const sizes = [1, 4, 127, 128, 255, 256, 0x10000, 0x10001]
      for (const size of sizes) {
        const encoded = encodeCopyInstruction(0, size)
        const decoded = decodeCopyInstruction(encoded, 0)
        expect(decoded.offset).toBe(0)
        expect(decoded.size).toBe(size)
      }
    })

    it('should handle copy where only high byte of offset is set', () => {
      // Offset 0x01000000 - only byte 4 is non-zero
      const offset = 0x01000000
      const encoded = encodeCopyInstruction(offset, 10)
      const decoded = decodeCopyInstruction(encoded, 0)
      expect(decoded.offset).toBe(offset)
    })

    it('should handle copy where only high byte of size is set', () => {
      // Size 0x010000 - only byte 3 is non-zero
      const size = 0x010000
      const encoded = encodeCopyInstruction(0, size)
      const decoded = decodeCopyInstruction(encoded, 0)
      expect(decoded.size).toBe(size)
    })
  })
})

// =============================================================================
// Delta Creation Quality Tests
// =============================================================================

describe('Delta Creation Quality', () => {
  it('should create efficient delta for similar content', () => {
    const base = encoder.encode('The quick brown fox jumps over the lazy dog.')
    const target = encoder.encode('The quick brown cat jumps over the lazy dog.')

    const delta = createDelta(base, target)

    // Delta should be smaller than full target
    expect(delta.length).toBeLessThan(target.length)

    // Should still produce correct output
    const result = applyDelta(base, delta)
    expect(result).toEqual(target)
  })

  it('should handle appending content efficiently', () => {
    const base = encoder.encode('Hello')
    const target = encoder.encode('Hello, World!')

    const delta = createDelta(base, target)
    const result = applyDelta(base, delta)
    expect(result).toEqual(target)
  })

  it('should handle prepending content', () => {
    const base = encoder.encode('World!')
    const target = encoder.encode('Hello, World!')

    const delta = createDelta(base, target)
    const result = applyDelta(base, delta)
    expect(result).toEqual(target)
  })

  it('should handle inserting content in middle', () => {
    const base = encoder.encode('HelloWorld')
    const target = encoder.encode('Hello, World')

    const delta = createDelta(base, target)
    const result = applyDelta(base, delta)
    expect(result).toEqual(target)
  })

  it('should handle removing content', () => {
    const base = encoder.encode('Hello, World!')
    const target = encoder.encode('Hello!')

    const delta = createDelta(base, target)
    const result = applyDelta(base, delta)
    expect(result).toEqual(target)
  })
})
