/**
 * @fileoverview RED Phase Tests - Git Pack File Format
 *
 * These tests specify the complete behavior for Git pack file handling.
 * They are designed to FAIL initially (RED phase) and will pass once
 * the implementation is complete (GREEN phase).
 *
 * Tests cover:
 * 1. Pack header - magic "PACK", version (2), object count
 * 2. Pack index format - fanout table, SHA list, CRC, offsets
 * 3. Object types in pack: commit, tree, blob, tag, ofs_delta, ref_delta
 * 4. Object header encoding (type + size in variable-length format)
 * 5. Pack checksum (SHA-1 of all content)
 * 6. Index v2 format specifics
 * 7. Large file offset handling (8-byte offsets)
 * 8. Pack streaming/parsing
 *
 * @module test/core/pack/pack-format
 */

import { describe, it, expect, beforeEach } from 'vitest'

// These imports will fail until the core/pack module is implemented
import {
  // Pack file constants
  PACK_MAGIC,
  PACK_VERSION,

  // Pack object types
  PackObjectType,
  OBJ_COMMIT,
  OBJ_TREE,
  OBJ_BLOB,
  OBJ_TAG,
  OBJ_OFS_DELTA,
  OBJ_REF_DELTA,

  // Pack header operations
  PackHeader,
  parsePackHeader,
  createPackHeader,
  validatePackHeader,

  // Object header encoding/decoding
  encodeObjectHeader,
  decodeObjectHeader,
  encodeVariableLengthSize,
  decodeVariableLengthSize,

  // Pack checksum
  computePackChecksum,
  verifyPackChecksum,

  // Pack index constants
  PACK_INDEX_MAGIC,
  PACK_INDEX_VERSION_2,
  LARGE_OFFSET_THRESHOLD,

  // Pack index structures
  PackIndex,
  PackIndexEntry,
  FanoutTable,

  // Pack index operations
  parsePackIndex,
  createPackIndex,
  serializePackIndex,
  lookupObjectInIndex,

  // Fanout table operations
  parseFanoutTable,
  createFanoutTable,
  getFanoutRange,

  // CRC32 operations
  calculateCRC32,

  // Pack streaming/parsing
  PackParser,
  PackWriter,
  PackObjectIterator,

  // Delta handling
  parseDeltaOffset,
  encodeDeltaOffset,

  // Large offset handling
  readLargeOffset,
  writeLargeOffset,
  isLargeOffset,
} from '../../../core/pack'


// =============================================================================
// Test Helpers
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

function createTestSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

function createTestShaBytes(prefix: string): Uint8Array {
  return hexToBytes(createTestSha(prefix))
}

/**
 * Creates a minimal valid pack header for testing
 */
function createMinimalPackHeader(objectCount: number): Uint8Array {
  const header = new Uint8Array(12)
  // PACK magic
  header[0] = 0x50 // P
  header[1] = 0x41 // A
  header[2] = 0x43 // C
  header[3] = 0x4b // K
  // Version 2 (big-endian)
  header[4] = 0x00
  header[5] = 0x00
  header[6] = 0x00
  header[7] = 0x02
  // Object count (big-endian)
  header[8] = (objectCount >> 24) & 0xff
  header[9] = (objectCount >> 16) & 0xff
  header[10] = (objectCount >> 8) & 0xff
  header[11] = objectCount & 0xff
  return header
}

/**
 * Creates a minimal pack index v2 header
 */
function createPackIndexHeader(): Uint8Array {
  const header = new Uint8Array(8)
  // Magic: 0xff 0x74 0x4f 0x63 ("\377tOc")
  header[0] = 0xff
  header[1] = 0x74
  header[2] = 0x4f
  header[3] = 0x63
  // Version 2 (big-endian)
  header[4] = 0x00
  header[5] = 0x00
  header[6] = 0x00
  header[7] = 0x02
  return header
}


// =============================================================================
// SECTION 1: Pack Header Tests
// =============================================================================

describe('Pack Header', () => {
  describe('Constants', () => {
    it('should define PACK_MAGIC as "PACK" (0x5041434b)', () => {
      expect(PACK_MAGIC).toBe('PACK')
    })

    it('should define PACK_VERSION as 2', () => {
      expect(PACK_VERSION).toBe(2)
    })

    it('should have PACK magic bytes as 0x50, 0x41, 0x43, 0x4b', () => {
      const magicBytes = encoder.encode(PACK_MAGIC)
      expect(magicBytes[0]).toBe(0x50) // P
      expect(magicBytes[1]).toBe(0x41) // A
      expect(magicBytes[2]).toBe(0x43) // C
      expect(magicBytes[3]).toBe(0x4b) // K
    })
  })

  describe('parsePackHeader', () => {
    it('should parse valid 12-byte pack header', () => {
      const data = createMinimalPackHeader(5)
      const header = parsePackHeader(data)

      expect(header.magic).toBe('PACK')
      expect(header.version).toBe(2)
      expect(header.objectCount).toBe(5)
    })

    it('should parse header with zero objects', () => {
      const data = createMinimalPackHeader(0)
      const header = parsePackHeader(data)

      expect(header.objectCount).toBe(0)
    })

    it('should parse header with large object count', () => {
      const data = createMinimalPackHeader(0x00ffffff) // ~16 million objects
      const header = parsePackHeader(data)

      expect(header.objectCount).toBe(0x00ffffff)
    })

    it('should parse header with maximum object count (4294967295)', () => {
      const header = new Uint8Array(12)
      header.set([0x50, 0x41, 0x43, 0x4b], 0) // PACK
      header.set([0x00, 0x00, 0x00, 0x02], 4) // version 2
      header.set([0xff, 0xff, 0xff, 0xff], 8) // max count

      const parsed = parsePackHeader(header)
      expect(parsed.objectCount).toBe(0xffffffff)
    })

    it('should throw for data shorter than 12 bytes', () => {
      const shortData = new Uint8Array(11)
      expect(() => parsePackHeader(shortData)).toThrow(/too short|truncated|invalid/i)
    })

    it('should throw for invalid magic signature', () => {
      const data = new Uint8Array(12)
      data.set([0x00, 0x00, 0x00, 0x00], 0) // Invalid magic
      data.set([0x00, 0x00, 0x00, 0x02], 4)
      data.set([0x00, 0x00, 0x00, 0x01], 8)

      expect(() => parsePackHeader(data)).toThrow(/signature|magic|invalid/i)
    })

    it('should throw for partially correct magic (PAC\\0)', () => {
      const data = new Uint8Array(12)
      data.set([0x50, 0x41, 0x43, 0x00], 0) // PAC\0
      data.set([0x00, 0x00, 0x00, 0x02], 4)
      data.set([0x00, 0x00, 0x00, 0x01], 8)

      expect(() => parsePackHeader(data)).toThrow(/signature|magic|invalid/i)
    })

    it('should throw for unsupported version 1', () => {
      const data = new Uint8Array(12)
      data.set([0x50, 0x41, 0x43, 0x4b], 0)
      data.set([0x00, 0x00, 0x00, 0x01], 4) // version 1
      data.set([0x00, 0x00, 0x00, 0x01], 8)

      expect(() => parsePackHeader(data)).toThrow(/version/i)
    })

    it('should throw for unsupported version 3', () => {
      const data = new Uint8Array(12)
      data.set([0x50, 0x41, 0x43, 0x4b], 0)
      data.set([0x00, 0x00, 0x00, 0x03], 4) // version 3
      data.set([0x00, 0x00, 0x00, 0x01], 8)

      expect(() => parsePackHeader(data)).toThrow(/version/i)
    })

    it('should throw for version 0', () => {
      const data = new Uint8Array(12)
      data.set([0x50, 0x41, 0x43, 0x4b], 0)
      data.set([0x00, 0x00, 0x00, 0x00], 4) // version 0
      data.set([0x00, 0x00, 0x00, 0x01], 8)

      expect(() => parsePackHeader(data)).toThrow(/version/i)
    })

    it('should parse from offset within larger buffer', () => {
      const buffer = new Uint8Array(100)
      const header = createMinimalPackHeader(42)
      buffer.set(header, 50) // Header at offset 50

      const parsed = parsePackHeader(buffer, 50)
      expect(parsed.objectCount).toBe(42)
    })
  })

  describe('createPackHeader', () => {
    it('should create valid 12-byte header', () => {
      const header = createPackHeader(10)
      expect(header.length).toBe(12)
    })

    it('should create header with correct magic', () => {
      const header = createPackHeader(0)
      expect(header[0]).toBe(0x50) // P
      expect(header[1]).toBe(0x41) // A
      expect(header[2]).toBe(0x43) // C
      expect(header[3]).toBe(0x4b) // K
    })

    it('should create header with version 2', () => {
      const header = createPackHeader(0)
      const version = (header[4] << 24) | (header[5] << 16) | (header[6] << 8) | header[7]
      expect(version).toBe(2)
    })

    it('should create header with correct object count in big-endian', () => {
      const header = createPackHeader(0x12345678)
      expect(header[8]).toBe(0x12)
      expect(header[9]).toBe(0x34)
      expect(header[10]).toBe(0x56)
      expect(header[11]).toBe(0x78)
    })

    it('should round-trip create and parse', () => {
      const counts = [0, 1, 100, 65536, 0xffffffff]
      for (const count of counts) {
        const created = createPackHeader(count)
        const parsed = parsePackHeader(created)
        expect(parsed.objectCount).toBe(count)
        expect(parsed.version).toBe(2)
        expect(parsed.magic).toBe('PACK')
      }
    })
  })

  describe('validatePackHeader', () => {
    it('should return true for valid header', () => {
      const header = createMinimalPackHeader(5)
      expect(validatePackHeader(header)).toBe(true)
    })

    it('should return false for invalid magic', () => {
      const header = new Uint8Array(12)
      header.set([0x00, 0x00, 0x00, 0x00], 0)
      expect(validatePackHeader(header)).toBe(false)
    })

    it('should return false for invalid version', () => {
      const header = createMinimalPackHeader(0)
      header[7] = 3 // Invalid version
      expect(validatePackHeader(header)).toBe(false)
    })

    it('should return false for truncated data', () => {
      const header = new Uint8Array(8)
      expect(validatePackHeader(header)).toBe(false)
    })
  })
})


// =============================================================================
// SECTION 2: Pack Object Types
// =============================================================================

describe('Pack Object Types', () => {
  describe('PackObjectType enum', () => {
    it('should define OBJ_COMMIT as 1', () => {
      expect(OBJ_COMMIT).toBe(1)
      expect(PackObjectType.COMMIT).toBe(1)
    })

    it('should define OBJ_TREE as 2', () => {
      expect(OBJ_TREE).toBe(2)
      expect(PackObjectType.TREE).toBe(2)
    })

    it('should define OBJ_BLOB as 3', () => {
      expect(OBJ_BLOB).toBe(3)
      expect(PackObjectType.BLOB).toBe(3)
    })

    it('should define OBJ_TAG as 4', () => {
      expect(OBJ_TAG).toBe(4)
      expect(PackObjectType.TAG).toBe(4)
    })

    it('should NOT define type 5 (reserved)', () => {
      // Type 5 is reserved in Git pack format
      expect(PackObjectType[5]).toBeUndefined()
    })

    it('should define OBJ_OFS_DELTA as 6', () => {
      expect(OBJ_OFS_DELTA).toBe(6)
      expect(PackObjectType.OFS_DELTA).toBe(6)
    })

    it('should define OBJ_REF_DELTA as 7', () => {
      expect(OBJ_REF_DELTA).toBe(7)
      expect(PackObjectType.REF_DELTA).toBe(7)
    })
  })

  describe('Object type validation', () => {
    it('should recognize valid base object types (1-4)', () => {
      const baseTypes = [OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG]
      for (const type of baseTypes) {
        expect(type).toBeGreaterThanOrEqual(1)
        expect(type).toBeLessThanOrEqual(4)
      }
    })

    it('should recognize valid delta object types (6-7)', () => {
      const deltaTypes = [OBJ_OFS_DELTA, OBJ_REF_DELTA]
      for (const type of deltaTypes) {
        expect(type).toBeGreaterThanOrEqual(6)
        expect(type).toBeLessThanOrEqual(7)
      }
    })

    it('should fit object type in 3 bits (values 0-7)', () => {
      const allTypes = [OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG, OBJ_OFS_DELTA, OBJ_REF_DELTA]
      for (const type of allTypes) {
        expect(type & 0b111).toBe(type)
      }
    })
  })
})


// =============================================================================
// SECTION 3: Object Header Encoding
// =============================================================================

describe('Object Header Encoding', () => {
  describe('Variable-length size encoding', () => {
    describe('encodeVariableLengthSize', () => {
      it('should encode 0 as single byte [0x00]', () => {
        const encoded = encodeVariableLengthSize(0)
        expect(encoded).toEqual(new Uint8Array([0x00]))
      })

      it('should encode values 0-127 as single byte', () => {
        expect(encodeVariableLengthSize(0)).toEqual(new Uint8Array([0]))
        expect(encodeVariableLengthSize(1)).toEqual(new Uint8Array([1]))
        expect(encodeVariableLengthSize(127)).toEqual(new Uint8Array([127]))
      })

      it('should encode 128 as two bytes [0x80, 0x01]', () => {
        const encoded = encodeVariableLengthSize(128)
        expect(encoded).toEqual(new Uint8Array([0x80, 0x01]))
      })

      it('should encode 255 as [0xff, 0x01]', () => {
        const encoded = encodeVariableLengthSize(255)
        expect(encoded).toEqual(new Uint8Array([0xff, 0x01]))
      })

      it('should encode 16383 as [0xff, 0x7f]', () => {
        const encoded = encodeVariableLengthSize(16383)
        expect(encoded).toEqual(new Uint8Array([0xff, 0x7f]))
      })

      it('should encode 16384 as three bytes [0x80, 0x80, 0x01]', () => {
        const encoded = encodeVariableLengthSize(16384)
        expect(encoded).toEqual(new Uint8Array([0x80, 0x80, 0x01]))
      })

      it('should encode large values (1MB)', () => {
        const oneMB = 1024 * 1024
        const encoded = encodeVariableLengthSize(oneMB)
        expect(encoded.length).toBeGreaterThan(2)
      })

      it('should encode very large values (1GB)', () => {
        const oneGB = 1024 * 1024 * 1024
        const encoded = encodeVariableLengthSize(oneGB)
        expect(encoded.length).toBeGreaterThan(3)
      })
    })

    describe('decodeVariableLengthSize', () => {
      it('should decode single byte [0x00] as 0', () => {
        const { value, bytesRead } = decodeVariableLengthSize(new Uint8Array([0x00]), 0)
        expect(value).toBe(0)
        expect(bytesRead).toBe(1)
      })

      it('should decode single byte values correctly', () => {
        for (let i = 0; i < 128; i++) {
          const { value, bytesRead } = decodeVariableLengthSize(new Uint8Array([i]), 0)
          expect(value).toBe(i)
          expect(bytesRead).toBe(1)
        }
      })

      it('should decode [0x80, 0x01] as 128', () => {
        const { value, bytesRead } = decodeVariableLengthSize(new Uint8Array([0x80, 0x01]), 0)
        expect(value).toBe(128)
        expect(bytesRead).toBe(2)
      })

      it('should decode from offset', () => {
        const data = new Uint8Array([0xaa, 0xbb, 0x80, 0x01, 0xcc])
        const { value, bytesRead } = decodeVariableLengthSize(data, 2)
        expect(value).toBe(128)
        expect(bytesRead).toBe(2)
      })

      it('should throw for truncated data (continuation bit set but no next byte)', () => {
        const truncated = new Uint8Array([0x80])
        expect(() => decodeVariableLengthSize(truncated, 0)).toThrow(/truncated|end of data/i)
      })

      it('should round-trip encode/decode', () => {
        const testValues = [0, 1, 127, 128, 255, 16383, 16384, 2097151, 268435455]
        for (const original of testValues) {
          const encoded = encodeVariableLengthSize(original)
          const { value } = decodeVariableLengthSize(encoded, 0)
          expect(value).toBe(original)
        }
      })
    })
  })

  describe('Object header (type + size)', () => {
    describe('encodeObjectHeader', () => {
      it('should encode type in bits 4-6 of first byte', () => {
        const header = encodeObjectHeader(OBJ_BLOB, 0)
        const typeBits = (header[0] >> 4) & 0x07
        expect(typeBits).toBe(OBJ_BLOB)
      })

      it('should encode size bits 0-3 in low nibble of first byte', () => {
        const header = encodeObjectHeader(OBJ_BLOB, 5)
        expect(header[0] & 0x0f).toBe(5)
      })

      it('should encode size 0-15 in single byte (no continuation)', () => {
        for (let size = 0; size <= 15; size++) {
          const header = encodeObjectHeader(OBJ_COMMIT, size)
          expect(header.length).toBe(1)
          expect(header[0] & 0x80).toBe(0) // No continuation bit
        }
      })

      it('should set continuation bit for size >= 16', () => {
        const header = encodeObjectHeader(OBJ_COMMIT, 16)
        expect(header[0] & 0x80).toBe(0x80)
        expect(header.length).toBeGreaterThan(1)
      })

      it('should encode each object type correctly', () => {
        const types = [
          { type: OBJ_COMMIT, expected: 1 },
          { type: OBJ_TREE, expected: 2 },
          { type: OBJ_BLOB, expected: 3 },
          { type: OBJ_TAG, expected: 4 },
          { type: OBJ_OFS_DELTA, expected: 6 },
          { type: OBJ_REF_DELTA, expected: 7 },
        ]

        for (const { type, expected } of types) {
          const header = encodeObjectHeader(type, 0)
          const typeBits = (header[0] >> 4) & 0x07
          expect(typeBits).toBe(expected)
        }
      })

      it('should encode type 1 (commit), size 5 as 0x15', () => {
        const header = encodeObjectHeader(OBJ_COMMIT, 5)
        expect(header[0]).toBe(0x15) // (1 << 4) | 5
      })

      it('should encode type 3 (blob), size 15 as 0x3f', () => {
        const header = encodeObjectHeader(OBJ_BLOB, 15)
        expect(header[0]).toBe(0x3f) // (3 << 4) | 15
      })

      it('should encode large sizes correctly (100 bytes)', () => {
        const header = encodeObjectHeader(OBJ_BLOB, 100)
        const decoded = decodeObjectHeader(header, 0)
        expect(decoded.type).toBe(OBJ_BLOB)
        expect(decoded.size).toBe(100)
      })

      it('should encode very large sizes (1MB)', () => {
        const oneMB = 1024 * 1024
        const header = encodeObjectHeader(OBJ_BLOB, oneMB)
        const decoded = decodeObjectHeader(header, 0)
        expect(decoded.type).toBe(OBJ_BLOB)
        expect(decoded.size).toBe(oneMB)
      })
    })

    describe('decodeObjectHeader', () => {
      it('should decode type from bits 4-6 of first byte', () => {
        const data = new Uint8Array([0x35]) // type 3, size 5
        const { type } = decodeObjectHeader(data, 0)
        expect(type).toBe(OBJ_BLOB)
      })

      it('should decode size from low nibble when no continuation', () => {
        const data = new Uint8Array([0x15]) // type 1, size 5
        const { size } = decodeObjectHeader(data, 0)
        expect(size).toBe(5)
      })

      it('should decode continuation bytes for larger sizes', () => {
        // type 1, size 16 = 0x91 0x01 (continuation bit set, then 16>>4 = 1)
        const encoded = encodeObjectHeader(OBJ_COMMIT, 16)
        const { type, size } = decodeObjectHeader(encoded, 0)
        expect(type).toBe(OBJ_COMMIT)
        expect(size).toBe(16)
      })

      it('should return bytesRead', () => {
        const header1 = encodeObjectHeader(OBJ_COMMIT, 5)
        const result1 = decodeObjectHeader(header1, 0)
        expect(result1.bytesRead).toBe(1)

        const header2 = encodeObjectHeader(OBJ_COMMIT, 100)
        const result2 = decodeObjectHeader(header2, 0)
        expect(result2.bytesRead).toBeGreaterThan(1)
      })

      it('should decode from offset in larger buffer', () => {
        const header = encodeObjectHeader(OBJ_TAG, 42)
        const buffer = new Uint8Array(100)
        buffer.set(header, 50)

        const { type, size } = decodeObjectHeader(buffer, 50)
        expect(type).toBe(OBJ_TAG)
        expect(size).toBe(42)
      })

      it('should throw for truncated header', () => {
        const truncated = new Uint8Array([0x91]) // Continuation expected
        expect(() => decodeObjectHeader(truncated, 0)).toThrow(/truncated/i)
      })

      it('should throw for offset beyond buffer', () => {
        const data = new Uint8Array(5)
        expect(() => decodeObjectHeader(data, 10)).toThrow(/offset|bounds/i)
      })

      it('should round-trip all types and various sizes', () => {
        const types = [OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG, OBJ_OFS_DELTA, OBJ_REF_DELTA]
        const sizes = [0, 1, 15, 16, 127, 128, 1000, 65535, 1000000]

        for (const type of types) {
          for (const size of sizes) {
            const encoded = encodeObjectHeader(type, size)
            const decoded = decodeObjectHeader(encoded, 0)
            expect(decoded.type).toBe(type)
            expect(decoded.size).toBe(size)
          }
        }
      })
    })
  })
})


// =============================================================================
// SECTION 4: Pack Checksum
// =============================================================================

describe('Pack Checksum', () => {
  describe('computePackChecksum', () => {
    it('should compute SHA-1 of pack content (excluding trailer)', () => {
      const header = createMinimalPackHeader(0)
      const checksum = computePackChecksum(header)
      expect(checksum.length).toBe(20)
    })

    it('should produce different checksums for different content', () => {
      const header1 = createMinimalPackHeader(0)
      const header2 = createMinimalPackHeader(1)

      const checksum1 = computePackChecksum(header1)
      const checksum2 = computePackChecksum(header2)

      expect(bytesToHex(checksum1)).not.toBe(bytesToHex(checksum2))
    })

    it('should produce consistent checksums for same content', () => {
      const header = createMinimalPackHeader(42)

      const checksum1 = computePackChecksum(header)
      const checksum2 = computePackChecksum(header)

      expect(bytesToHex(checksum1)).toBe(bytesToHex(checksum2))
    })

    it('should compute checksum as SHA-1', () => {
      // SHA-1 produces exactly 20 bytes (160 bits)
      const checksum = computePackChecksum(new Uint8Array(100))
      expect(checksum.length).toBe(20)
    })
  })

  describe('verifyPackChecksum', () => {
    it('should return true for valid pack with correct checksum', () => {
      const header = createMinimalPackHeader(0)
      const checksum = computePackChecksum(header)

      // Create complete pack with trailer
      const pack = new Uint8Array(header.length + 20)
      pack.set(header, 0)
      pack.set(checksum, header.length)

      expect(verifyPackChecksum(pack)).toBe(true)
    })

    it('should return false for pack with corrupted checksum', () => {
      const header = createMinimalPackHeader(0)
      const checksum = computePackChecksum(header)

      const pack = new Uint8Array(header.length + 20)
      pack.set(header, 0)
      pack.set(checksum, header.length)

      // Corrupt the checksum
      pack[pack.length - 1] ^= 0xff

      expect(verifyPackChecksum(pack)).toBe(false)
    })

    it('should return false for pack with corrupted content', () => {
      const header = createMinimalPackHeader(5)
      const checksum = computePackChecksum(header)

      const pack = new Uint8Array(header.length + 20)
      pack.set(header, 0)
      pack.set(checksum, header.length)

      // Corrupt the content
      pack[10] ^= 0xff

      expect(verifyPackChecksum(pack)).toBe(false)
    })

    it('should throw for pack shorter than 20 bytes', () => {
      const shortPack = new Uint8Array(15)
      expect(() => verifyPackChecksum(shortPack)).toThrow(/too short/i)
    })
  })
})


// =============================================================================
// SECTION 5: Pack Index Format (Version 2)
// =============================================================================

describe('Pack Index Format (Version 2)', () => {
  describe('Constants', () => {
    it('should define PACK_INDEX_MAGIC as 0xff744f63', () => {
      expect(PACK_INDEX_MAGIC).toBe(0xff744f63)
    })

    it('should define PACK_INDEX_VERSION_2 as 2', () => {
      expect(PACK_INDEX_VERSION_2).toBe(2)
    })

    it('should define LARGE_OFFSET_THRESHOLD as 0x80000000 (2GB)', () => {
      expect(LARGE_OFFSET_THRESHOLD).toBe(0x80000000)
    })
  })

  describe('Fanout Table', () => {
    describe('parseFanoutTable', () => {
      it('should parse 256 entries from 1024 bytes', () => {
        const fanoutData = new Uint8Array(256 * 4)
        const fanout = parseFanoutTable(fanoutData)

        expect(fanout.length).toBe(256)
        expect(fanout).toBeInstanceOf(Uint32Array)
      })

      it('should parse values as big-endian uint32', () => {
        const fanoutData = new Uint8Array(256 * 4)
        const view = new DataView(fanoutData.buffer)

        view.setUint32(0 * 4, 5, false) // fanout[0] = 5
        view.setUint32(1 * 4, 10, false) // fanout[1] = 10
        view.setUint32(255 * 4, 100, false) // fanout[255] = 100

        const fanout = parseFanoutTable(fanoutData)

        expect(fanout[0]).toBe(5)
        expect(fanout[1]).toBe(10)
        expect(fanout[255]).toBe(100)
      })

      it('should handle maximum values (0xffffffff)', () => {
        const fanoutData = new Uint8Array(256 * 4)
        const view = new DataView(fanoutData.buffer)
        view.setUint32(255 * 4, 0xffffffff, false)

        const fanout = parseFanoutTable(fanoutData)
        expect(fanout[255]).toBe(0xffffffff)
      })
    })

    describe('createFanoutTable', () => {
      it('should create 256-entry table from sorted entries', () => {
        const entries: PackIndexEntry[] = [
          { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
          { sha: 'ff' + '0'.repeat(38), offset: 200, crc32: 2 },
        ]

        const fanout = createFanoutTable(entries)

        expect(fanout.length).toBe(256)
        expect(fanout).toBeInstanceOf(Uint32Array)
      })

      it('should have monotonically non-decreasing values', () => {
        const entries: PackIndexEntry[] = [
          { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
          { sha: '80' + '0'.repeat(38), offset: 200, crc32: 2 },
          { sha: 'ff' + '0'.repeat(38), offset: 300, crc32: 3 },
        ]

        const fanout = createFanoutTable(entries)

        for (let i = 1; i < 256; i++) {
          expect(fanout[i]).toBeGreaterThanOrEqual(fanout[i - 1])
        }
      })

      it('should set fanout[255] to total object count', () => {
        const entries: PackIndexEntry[] = [
          { sha: 'ab' + '0'.repeat(38), offset: 100, crc32: 1 },
          { sha: 'cd' + '0'.repeat(38), offset: 200, crc32: 2 },
          { sha: 'ef' + '0'.repeat(38), offset: 300, crc32: 3 },
        ]

        const fanout = createFanoutTable(entries)
        expect(fanout[255]).toBe(3)
      })

      it('should handle empty entry list', () => {
        const fanout = createFanoutTable([])
        expect(fanout[255]).toBe(0)
        for (let i = 0; i < 256; i++) {
          expect(fanout[i]).toBe(0)
        }
      })

      it('should correctly count entries for each first byte', () => {
        const entries: PackIndexEntry[] = [
          { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
          { sha: '00' + 'f'.repeat(38), offset: 200, crc32: 2 },
          { sha: '01' + '0'.repeat(38), offset: 300, crc32: 3 },
        ]

        const fanout = createFanoutTable(entries)

        expect(fanout[0x00]).toBe(2) // Two entries starting with 0x00
        expect(fanout[0x01]).toBe(3) // Cumulative: includes 0x01 entry
      })
    })

    describe('getFanoutRange', () => {
      it('should return range [0, fanout[0]) for first byte 0x00', () => {
        const fanout = new Uint32Array(256)
        fanout[0] = 5

        const { start, end } = getFanoutRange(fanout, 0x00)

        expect(start).toBe(0)
        expect(end).toBe(5)
      })

      it('should return range [fanout[i-1], fanout[i]) for byte i > 0', () => {
        const fanout = new Uint32Array(256)
        fanout[0] = 3
        fanout[1] = 7

        const { start, end } = getFanoutRange(fanout, 0x01)

        expect(start).toBe(3)
        expect(end).toBe(7)
      })

      it('should return empty range when no entries for that byte', () => {
        const fanout = new Uint32Array(256)
        fanout[0] = 5
        fanout[1] = 5 // Same as previous = empty range

        const { start, end } = getFanoutRange(fanout, 0x01)

        expect(start).toBe(5)
        expect(end).toBe(5) // Empty range
      })

      it('should handle last byte (0xff)', () => {
        const fanout = new Uint32Array(256)
        fanout[254] = 95
        fanout[255] = 100

        const { start, end } = getFanoutRange(fanout, 0xff)

        expect(start).toBe(95)
        expect(end).toBe(100)
      })
    })
  })

  describe('parsePackIndex', () => {
    it('should parse valid index v2 header', () => {
      // Create minimal valid index
      const indexSize = 8 + 256 * 4 + 40 // header + fanout + checksums
      const data = new Uint8Array(indexSize)

      // Set magic and version
      const header = createPackIndexHeader()
      data.set(header, 0)

      // Would need proper checksum, but test should still check structure
      const index = parsePackIndex(data)

      expect(index.version).toBe(2)
    })

    it('should extract object count from fanout[255]', () => {
      // Test with proper implementation
      const index = parsePackIndex(createValidTestIndex(5))
      expect(index.objectCount).toBe(5)
    })

    it('should parse SHA-1 list as 40-character hex strings', () => {
      const index = parsePackIndex(createValidTestIndex(2))
      for (const entry of index.entries) {
        expect(entry.sha?.length).toBe(40)
        expect(/^[0-9a-f]{40}$/.test(entry.sha!)).toBe(true)
      }
    })

    it('should parse CRC32 values', () => {
      const index = parsePackIndex(createValidTestIndex(1))
      expect(typeof index.entries[0].crc32).toBe('number')
    })

    it('should parse 4-byte offsets', () => {
      const index = parsePackIndex(createValidTestIndex(1))
      expect(typeof index.entries[0].offset).toBe('number')
    })

    it('should throw for invalid magic number', () => {
      const data = new Uint8Array(8 + 256 * 4 + 40)
      data[0] = 0x00 // Invalid first byte

      expect(() => parsePackIndex(data)).toThrow(/magic|signature/i)
    })

    it('should throw for version 1 (no magic)', () => {
      const data = new Uint8Array(256 * 4 + 40) // v1 format

      expect(() => parsePackIndex(data)).toThrow(/version|magic/i)
    })

    it('should throw for unsupported version 3', () => {
      const data = new Uint8Array(8 + 256 * 4 + 40)
      data.set(createPackIndexHeader(), 0)
      data[7] = 3 // Version 3

      expect(() => parsePackIndex(data)).toThrow(/version/i)
    })

    it('should throw for truncated data', () => {
      const data = new Uint8Array(100) // Too short
      data.set(createPackIndexHeader(), 0)

      expect(() => parsePackIndex(data)).toThrow(/truncated|too short/i)
    })

    it('should throw for invalid fanout (decreasing values)', () => {
      const data = new Uint8Array(8 + 256 * 4 + 40)
      data.set(createPackIndexHeader(), 0)

      const view = new DataView(data.buffer)
      view.setUint32(8 + 0 * 4, 10, false) // fanout[0] = 10
      view.setUint32(8 + 1 * 4, 5, false) // fanout[1] = 5 (invalid!)

      expect(() => parsePackIndex(data)).toThrow(/fanout|monotonic/i)
    })

    it('should parse pack checksum (last 40 bytes before index checksum)', () => {
      const index = parsePackIndex(createValidTestIndex(0))
      expect(index.packChecksum.length).toBe(20)
    })

    it('should parse index checksum (last 20 bytes)', () => {
      const index = parsePackIndex(createValidTestIndex(0))
      expect(index.indexChecksum.length).toBe(20)
    })
  })

  describe('createPackIndex', () => {
    it('should create index with correct magic number', () => {
      const indexData = createPackIndex([], new Uint8Array(20))

      expect(indexData[0]).toBe(0xff)
      expect(indexData[1]).toBe(0x74)
      expect(indexData[2]).toBe(0x4f)
      expect(indexData[3]).toBe(0x63)
    })

    it('should create index with version 2', () => {
      const indexData = createPackIndex([], new Uint8Array(20))
      const version = (indexData[4] << 24) | (indexData[5] << 16) |
                     (indexData[6] << 8) | indexData[7]
      expect(version).toBe(2)
    })

    it('should sort entries by SHA', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'ff' + '0'.repeat(38), offset: 300, crc32: 3 },
        { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
        { sha: '80' + '0'.repeat(38), offset: 200, crc32: 2 },
      ]

      const indexData = createPackIndex(entries, new Uint8Array(20))
      const parsed = parsePackIndex(indexData)

      // Should be sorted
      expect(parsed.entries[0].sha).toBe('00' + '0'.repeat(38))
      expect(parsed.entries[1].sha).toBe('80' + '0'.repeat(38))
      expect(parsed.entries[2].sha).toBe('ff' + '0'.repeat(38))
    })

    it('should include pack checksum', () => {
      const packChecksum = new Uint8Array(20).fill(0x42)
      const indexData = createPackIndex([], packChecksum)
      const parsed = parsePackIndex(indexData)

      expect(bytesToHex(parsed.packChecksum)).toBe('42'.repeat(20))
    })

    it('should compute and include index checksum', () => {
      const indexData = createPackIndex([], new Uint8Array(20))
      const parsed = parsePackIndex(indexData)

      expect(parsed.indexChecksum.length).toBe(20)
    })

    it('should use 8-byte offsets for large files (>2GB)', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'ab' + '0'.repeat(38), offset: 0x100000000, crc32: 1 }, // 4GB
      ]

      const indexData = createPackIndex(entries, new Uint8Array(20))
      const parsed = parsePackIndex(indexData)

      expect(parsed.entries[0].offset).toBe(0x100000000)
    })
  })

  describe('serializePackIndex', () => {
    it('should round-trip serialize and parse', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'aa' + '0'.repeat(38), offset: 100, crc32: 0x12345678 },
        { sha: 'bb' + '0'.repeat(38), offset: 200, crc32: 0x87654321 },
      ]

      const original: PackIndex = {
        version: 2,
        objectCount: 2,
        fanout: createFanoutTable(entries),
        entries,
        packChecksum: new Uint8Array(20).fill(0xaa),
        indexChecksum: new Uint8Array(20), // Will be computed
      }

      const serialized = serializePackIndex(original)
      const parsed = parsePackIndex(serialized)

      expect(parsed.version).toBe(2)
      expect(parsed.objectCount).toBe(2)
      expect(parsed.entries.length).toBe(2)
      expect(parsed.entries[0].sha).toBe(original.entries[0].sha)
      expect(parsed.entries[0].offset).toBe(original.entries[0].offset)
      expect(parsed.entries[0].crc32).toBe(original.entries[0].crc32)
    })
  })

  describe('lookupObjectInIndex', () => {
    it('should find object by exact SHA match', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'aa' + '0'.repeat(38), offset: 100, crc32: 1 },
        { sha: 'bb' + '0'.repeat(38), offset: 200, crc32: 2 },
        { sha: 'cc' + '0'.repeat(38), offset: 300, crc32: 3 },
      ]

      const index: PackIndex = {
        version: 2,
        objectCount: 3,
        fanout: createFanoutTable(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20),
      }

      const result = lookupObjectInIndex(index, 'bb' + '0'.repeat(38))

      expect(result).not.toBeNull()
      expect(result!.sha).toBe('bb' + '0'.repeat(38))
      expect(result!.offset).toBe(200)
    })

    it('should return null for missing object', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'aa' + '0'.repeat(38), offset: 100, crc32: 1 },
      ]

      const index: PackIndex = {
        version: 2,
        objectCount: 1,
        fanout: createFanoutTable(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20),
      }

      const result = lookupObjectInIndex(index, 'ff' + '0'.repeat(38))
      expect(result).toBeNull()
    })

    it('should use fanout table for efficient lookup', () => {
      // Create many entries to ensure fanout is used
      const entries: PackIndexEntry[] = []
      for (let i = 0; i < 256; i++) {
        entries.push({
          sha: i.toString(16).padStart(2, '0') + '0'.repeat(38),
          offset: i * 100,
          crc32: i,
        })
      }

      const index: PackIndex = {
        version: 2,
        objectCount: 256,
        fanout: createFanoutTable(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20),
      }

      // Should find object at 0xff bucket
      const result = lookupObjectInIndex(index, 'ff' + '0'.repeat(38))
      expect(result).not.toBeNull()
      expect(result!.offset).toBe(255 * 100)
    })

    it('should handle empty index', () => {
      const index: PackIndex = {
        version: 2,
        objectCount: 0,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20),
      }

      const result = lookupObjectInIndex(index, 'ab' + '0'.repeat(38))
      expect(result).toBeNull()
    })

    it('should throw for invalid SHA (wrong length)', () => {
      const index: PackIndex = {
        version: 2,
        objectCount: 0,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20),
      }

      expect(() => lookupObjectInIndex(index, 'abc')).toThrow(/sha|length|invalid/i)
    })

    it('should throw for invalid SHA (non-hex characters)', () => {
      const index: PackIndex = {
        version: 2,
        objectCount: 0,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20),
      }

      expect(() => lookupObjectInIndex(index, 'g'.repeat(40))).toThrow(/sha|hex|invalid/i)
    })
  })
})


// =============================================================================
// SECTION 6: CRC32 Calculation
// =============================================================================

describe('CRC32 Calculation', () => {
  describe('calculateCRC32', () => {
    it('should calculate CRC32 of empty data as 0x00000000', () => {
      const crc = calculateCRC32(new Uint8Array(0))
      expect(crc).toBe(0x00000000)
    })

    it('should calculate CRC32 of "hello" as 0x3610a686', () => {
      const crc = calculateCRC32(encoder.encode('hello'))
      expect(crc).toBe(0x3610a686)
    })

    it('should calculate CRC32 using IEEE 802.3 polynomial', () => {
      // Standard check value: CRC32("123456789") = 0xCBF43926
      const crc = calculateCRC32(encoder.encode('123456789'))
      expect(crc).toBe(0xcbf43926)
    })

    it('should return 32-bit unsigned integer', () => {
      const data = new Uint8Array([0xff, 0xff, 0xff, 0xff])
      const crc = calculateCRC32(data)

      expect(crc).toBeGreaterThanOrEqual(0)
      expect(crc).toBeLessThanOrEqual(0xffffffff)
    })

    it('should be consistent for same input', () => {
      const data = encoder.encode('consistent input')
      const crc1 = calculateCRC32(data)
      const crc2 = calculateCRC32(data)

      expect(crc1).toBe(crc2)
    })

    it('should differ for different inputs', () => {
      const crc1 = calculateCRC32(encoder.encode('foo'))
      const crc2 = calculateCRC32(encoder.encode('bar'))

      expect(crc1).not.toBe(crc2)
    })

    it('should handle binary data with null bytes', () => {
      const data = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      const crc = calculateCRC32(data)

      expect(typeof crc).toBe('number')
    })

    it('should handle large data (1MB)', () => {
      const data = new Uint8Array(1024 * 1024)
      const crc = calculateCRC32(data)

      expect(typeof crc).toBe('number')
      expect(crc).toBeGreaterThanOrEqual(0)
    })
  })
})


// =============================================================================
// SECTION 7: Large Offset Handling
// =============================================================================

describe('Large Offset Handling', () => {
  describe('isLargeOffset', () => {
    it('should return false for offset < 2GB', () => {
      expect(isLargeOffset(0)).toBe(false)
      expect(isLargeOffset(0x7fffffff)).toBe(false)
    })

    it('should return true for offset >= 2GB', () => {
      expect(isLargeOffset(0x80000000)).toBe(true)
      expect(isLargeOffset(0x100000000)).toBe(true)
    })

    it('should return true for very large offsets (8GB)', () => {
      expect(isLargeOffset(8 * 1024 * 1024 * 1024)).toBe(true)
    })
  })

  describe('readLargeOffset', () => {
    it('should read 8-byte big-endian offset', () => {
      const data = new Uint8Array(8)
      const view = new DataView(data.buffer)
      view.setBigUint64(0, 0x123456789abcdef0n, false)

      const offset = readLargeOffset(data, 0)
      expect(offset).toBe(0x123456789abcdef0)
    })

    it('should read from specified offset in buffer', () => {
      const data = new Uint8Array(16)
      const view = new DataView(data.buffer)
      view.setBigUint64(8, 0xaabbccddeeff0011n, false)

      const offset = readLargeOffset(data, 8)
      expect(offset).toBe(0xaabbccddeeff0011)
    })

    it('should handle maximum 8-byte value', () => {
      const data = new Uint8Array(8)
      const view = new DataView(data.buffer)
      // Use largest safe integer that fits in Number
      view.setBigUint64(0, BigInt(Number.MAX_SAFE_INTEGER), false)

      const offset = readLargeOffset(data, 0)
      expect(offset).toBe(Number.MAX_SAFE_INTEGER)
    })
  })

  describe('writeLargeOffset', () => {
    it('should write 8-byte big-endian offset', () => {
      const data = new Uint8Array(8)
      writeLargeOffset(data, 0, 0x123456789abcdef0)

      const view = new DataView(data.buffer)
      expect(view.getBigUint64(0, false)).toBe(0x123456789abcdef0n)
    })

    it('should write at specified offset in buffer', () => {
      const data = new Uint8Array(16)
      writeLargeOffset(data, 8, 0xaabbccddeeff0011)

      const view = new DataView(data.buffer)
      expect(view.getBigUint64(8, false)).toBe(0xaabbccddeeff0011n)
    })

    it('should round-trip with readLargeOffset', () => {
      const testValues = [
        0x80000000,
        0x100000000,
        0x123456789ab,
        Number.MAX_SAFE_INTEGER,
      ]

      for (const value of testValues) {
        const data = new Uint8Array(8)
        writeLargeOffset(data, 0, value)
        const read = readLargeOffset(data, 0)
        expect(read).toBe(value)
      }
    })
  })
})


// =============================================================================
// SECTION 8: Delta Object Handling
// =============================================================================

describe('Delta Object Handling', () => {
  describe('parseDeltaOffset (for OFS_DELTA)', () => {
    it('should parse single-byte offset (values 0-127)', () => {
      // Git OFS_DELTA uses a special encoding for negative offsets
      const data = new Uint8Array([0x10])
      const { offset, bytesRead } = parseDeltaOffset(data, 0)

      expect(offset).toBeGreaterThan(0)
      expect(bytesRead).toBe(1)
    })

    it('should parse multi-byte offset with continuation bits', () => {
      // Continuation format: MSB set = more bytes follow
      const data = new Uint8Array([0x80, 0x01])
      const { offset, bytesRead } = parseDeltaOffset(data, 0)

      expect(bytesRead).toBe(2)
      expect(offset).toBeGreaterThan(127)
    })

    it('should parse large offsets correctly', () => {
      // Test encoding for various offset values
      const testOffsets = [1, 127, 128, 16511, 2113663]

      for (const originalOffset of testOffsets) {
        const encoded = encodeDeltaOffset(originalOffset)
        const { offset } = parseDeltaOffset(encoded, 0)
        expect(offset).toBe(originalOffset)
      }
    })

    it('should throw for truncated data', () => {
      const data = new Uint8Array([0x80]) // Continuation expected
      expect(() => parseDeltaOffset(data, 0)).toThrow(/truncated/i)
    })
  })

  describe('encodeDeltaOffset', () => {
    it('should encode small offset in single byte', () => {
      const encoded = encodeDeltaOffset(1)
      expect(encoded.length).toBe(1)
      expect(encoded[0] & 0x80).toBe(0) // No continuation
    })

    it('should encode larger offsets with continuation bytes', () => {
      const encoded = encodeDeltaOffset(128)
      expect(encoded.length).toBeGreaterThan(1)
    })

    it('should round-trip with parseDeltaOffset', () => {
      const offsets = [1, 10, 127, 128, 1000, 16511, 2113663, 270549119]

      for (const original of offsets) {
        const encoded = encodeDeltaOffset(original)
        const { offset } = parseDeltaOffset(encoded, 0)
        expect(offset).toBe(original)
      }
    })

    it('should throw for offset <= 0', () => {
      expect(() => encodeDeltaOffset(0)).toThrow(/positive|invalid/i)
      expect(() => encodeDeltaOffset(-1)).toThrow(/positive|invalid/i)
    })
  })
})


// =============================================================================
// SECTION 9: Pack Streaming/Parsing
// =============================================================================

describe('Pack Streaming and Parsing', () => {
  describe('PackParser', () => {
    it('should construct with pack data', () => {
      const header = createMinimalPackHeader(0)
      const checksum = new Uint8Array(20)
      const packData = new Uint8Array(header.length + 20)
      packData.set(header)
      packData.set(checksum, header.length)

      const parser = new PackParser(packData)
      expect(parser).toBeDefined()
    })

    it('should parse and return header', () => {
      const packData = createMinimalValidPack(0)
      const parser = new PackParser(packData)
      const header = parser.getHeader()

      expect(header.magic).toBe('PACK')
      expect(header.version).toBe(2)
    })

    it('should report object count', () => {
      const packData = createMinimalValidPack(5)
      const parser = new PackParser(packData)

      expect(parser.getObjectCount()).toBe(5)
    })

    it('should throw for invalid pack data', () => {
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      expect(() => new PackParser(invalidData)).toThrow(/invalid|magic/i)
    })
  })

  describe('PackObjectIterator', () => {
    it('should iterate over objects in pack', () => {
      const packData = createPackWithObjects([
        { type: OBJ_BLOB, data: encoder.encode('hello') },
        { type: OBJ_BLOB, data: encoder.encode('world') },
      ])

      const iterator = new PackObjectIterator(packData)
      const objects = Array.from(iterator)

      expect(objects.length).toBe(2)
    })

    it('should yield objects with type, size, and data', () => {
      const packData = createPackWithObjects([
        { type: OBJ_BLOB, data: encoder.encode('test') },
      ])

      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.type).toBe(OBJ_BLOB)
      expect(obj.size).toBe(4)
      expect(decoder.decode(obj.data)).toBe('test')
    })

    it('should yield offset for each object', () => {
      const packData = createPackWithObjects([
        { type: OBJ_BLOB, data: encoder.encode('a') },
        { type: OBJ_BLOB, data: encoder.encode('b') },
      ])

      const iterator = new PackObjectIterator(packData)
      const objects = Array.from(iterator)

      // First object at offset 12 (after header)
      expect(objects[0].offset).toBe(12)
      // Second object after first
      expect(objects[1].offset).toBeGreaterThan(objects[0].offset)
    })

    it('should handle empty pack (0 objects)', () => {
      const packData = createPackWithObjects([])

      const iterator = new PackObjectIterator(packData)
      const objects = Array.from(iterator)

      expect(objects.length).toBe(0)
    })

    it('should handle various object types', () => {
      const packData = createPackWithObjects([
        { type: OBJ_COMMIT, data: encoder.encode('commit data') },
        { type: OBJ_TREE, data: new Uint8Array([0x31, 0x30, 0x30]) },
        { type: OBJ_BLOB, data: encoder.encode('blob data') },
        { type: OBJ_TAG, data: encoder.encode('tag data') },
      ])

      const iterator = new PackObjectIterator(packData)
      const objects = Array.from(iterator)

      expect(objects[0].type).toBe(OBJ_COMMIT)
      expect(objects[1].type).toBe(OBJ_TREE)
      expect(objects[2].type).toBe(OBJ_BLOB)
      expect(objects[3].type).toBe(OBJ_TAG)
    })
  })

  describe('PackWriter', () => {
    it('should create empty pack writer', () => {
      const writer = new PackWriter()
      expect(writer).toBeDefined()
    })

    it('should add objects', () => {
      const writer = new PackWriter()
      writer.addObject(OBJ_BLOB, encoder.encode('hello'))
      expect(writer.getObjectCount()).toBe(1)
    })

    it('should generate valid pack data', () => {
      const writer = new PackWriter()
      writer.addObject(OBJ_BLOB, encoder.encode('test'))

      const packData = writer.finalize()

      // Should be valid pack
      const header = parsePackHeader(packData)
      expect(header.magic).toBe('PACK')
      expect(header.version).toBe(2)
      expect(header.objectCount).toBe(1)
    })

    it('should include checksum', () => {
      const writer = new PackWriter()
      writer.addObject(OBJ_BLOB, encoder.encode('test'))

      const packData = writer.finalize()

      expect(verifyPackChecksum(packData)).toBe(true)
    })

    it('should compress object data', () => {
      const writer = new PackWriter()
      // Highly compressible data
      const data = new Uint8Array(10000).fill(0x41)
      writer.addObject(OBJ_BLOB, data)

      const packData = writer.finalize()

      // Should be much smaller than raw data
      expect(packData.length).toBeLessThan(data.length)
    })

    it('should round-trip with PackObjectIterator', () => {
      const writer = new PackWriter()
      const originalData = encoder.encode('test content')
      writer.addObject(OBJ_BLOB, originalData)

      const packData = writer.finalize()
      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.type).toBe(OBJ_BLOB)
      expect(decoder.decode(obj.data)).toBe('test content')
    })
  })
})


// =============================================================================
// SECTION 10: Integration Tests
// =============================================================================

describe('Integration Tests', () => {
  describe('Complete pack creation and parsing workflow', () => {
    it('should create pack, generate index, and lookup objects', () => {
      // Create pack with multiple objects
      const writer = new PackWriter()
      const blobData = encoder.encode('Hello, World!')
      writer.addObject(OBJ_BLOB, blobData)

      const packData = writer.finalize()

      // Parse pack and build index
      const iterator = new PackObjectIterator(packData)
      const entries: PackIndexEntry[] = []

      for (const obj of iterator) {
        entries.push({
          sha: obj.sha,
          offset: obj.offset,
          crc32: obj.crc32,
        })
      }

      // Create and parse index
      const packChecksum = packData.slice(-20)
      const indexData = createPackIndex(entries, packChecksum)
      const index = parsePackIndex(indexData)

      // Lookup should work
      const entry = lookupObjectInIndex(index, entries[0].sha!)
      expect(entry).not.toBeNull()
      expect(entry!.offset).toBe(entries[0].offset)
    })

    it('should handle pack with mixed object types', () => {
      const writer = new PackWriter()

      writer.addObject(OBJ_BLOB, encoder.encode('file content'))
      writer.addObject(OBJ_TREE, new Uint8Array([0x31, 0x30, 0x30, 0x36, 0x34, 0x34]))
      writer.addObject(OBJ_COMMIT, encoder.encode('tree abc\nauthor x\n\nmessage'))

      const packData = writer.finalize()

      // Verify pack is valid
      const header = parsePackHeader(packData)
      expect(header.objectCount).toBe(3)

      // Verify all objects can be read
      const iterator = new PackObjectIterator(packData)
      const objects = Array.from(iterator)
      expect(objects.length).toBe(3)
    })

    it('should verify pack integrity through checksum', () => {
      const writer = new PackWriter()
      writer.addObject(OBJ_BLOB, encoder.encode('important data'))

      const packData = writer.finalize()

      // Valid pack should verify
      expect(verifyPackChecksum(packData)).toBe(true)

      // Corrupted pack should not verify
      const corrupted = new Uint8Array(packData)
      corrupted[20] ^= 0xff
      expect(verifyPackChecksum(corrupted)).toBe(false)
    })
  })

  describe('Real-world patterns', () => {
    it('should handle empty blob (tree entry mode 100644)', () => {
      const writer = new PackWriter()
      writer.addObject(OBJ_BLOB, new Uint8Array(0))

      const packData = writer.finalize()
      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.type).toBe(OBJ_BLOB)
      expect(obj.size).toBe(0)
    })

    it('should handle large blob (> 1MB)', () => {
      const writer = new PackWriter()
      const largeData = new Uint8Array(1024 * 1024 + 100)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      writer.addObject(OBJ_BLOB, largeData)

      const packData = writer.finalize()
      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.size).toBe(largeData.length)
    })

    it('should handle binary data with null bytes', () => {
      const writer = new PackWriter()
      const binaryData = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00])
      writer.addObject(OBJ_BLOB, binaryData)

      const packData = writer.finalize()
      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.data).toEqual(binaryData)
    })

    it('should handle maximum single-byte size objects (15 bytes)', () => {
      const writer = new PackWriter()
      const data = encoder.encode('exactly15chars!')
      expect(data.length).toBe(15)

      writer.addObject(OBJ_BLOB, data)

      const packData = writer.finalize()
      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.size).toBe(15)
      expect(decoder.decode(obj.data)).toBe('exactly15chars!')
    })

    it('should handle minimum multi-byte size objects (16 bytes)', () => {
      const writer = new PackWriter()
      const data = encoder.encode('exactly16chars!!')
      expect(data.length).toBe(16)

      writer.addObject(OBJ_BLOB, data)

      const packData = writer.finalize()
      const iterator = new PackObjectIterator(packData)
      const [obj] = Array.from(iterator)

      expect(obj.size).toBe(16)
    })
  })
})


// =============================================================================
// Test Helper Implementations (stubs for tests to compile)
// =============================================================================

/**
 * Creates a valid test pack index for testing
 * This is a test helper that creates properly formatted test data
 */
function createValidTestIndex(_objectCount: number): Uint8Array {
  // This will fail until implementation exists
  // The test should define what "valid" means
  throw new Error('Test helper not implemented - tests should fail in RED phase')
}

/**
 * Creates a minimal valid pack file
 */
function createMinimalValidPack(_objectCount: number): Uint8Array {
  // This will fail until implementation exists
  throw new Error('Test helper not implemented - tests should fail in RED phase')
}

/**
 * Creates a pack file with the given objects
 */
function createPackWithObjects(_objects: Array<{ type: number; data: Uint8Array }>): Uint8Array {
  // This will fail until implementation exists
  throw new Error('Test helper not implemented - tests should fail in RED phase')
}
