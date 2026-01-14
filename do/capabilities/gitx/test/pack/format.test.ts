import { describe, it, expect } from 'vitest'
import {
  PackObjectType,
  PACK_SIGNATURE,
  PACK_VERSION,
  parsePackHeader,
  parsePackObject,
  createPackfile,
  encodeVarint,
  decodeVarint,
  encodeTypeAndSize,
  decodeTypeAndSize,
  packObjectTypeToString,
  stringToPackObjectType
} from '../../src/pack/format'

// Helper functions
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

describe('Git Packfile Format', () => {
  describe('Constants', () => {
    it('should have correct PACK signature', () => {
      expect(PACK_SIGNATURE).toBe('PACK')
    })

    it('should have correct pack version', () => {
      expect(PACK_VERSION).toBe(2)
    })
  })

  describe('PackObjectType', () => {
    it('should have correct object type values', () => {
      expect(PackObjectType.OBJ_COMMIT).toBe(1)
      expect(PackObjectType.OBJ_TREE).toBe(2)
      expect(PackObjectType.OBJ_BLOB).toBe(3)
      expect(PackObjectType.OBJ_TAG).toBe(4)
      expect(PackObjectType.OBJ_OFS_DELTA).toBe(6)
      expect(PackObjectType.OBJ_REF_DELTA).toBe(7)
    })
  })

  describe('packObjectTypeToString', () => {
    it('should convert commit type to string', () => {
      expect(packObjectTypeToString(PackObjectType.OBJ_COMMIT)).toBe('commit')
    })

    it('should convert tree type to string', () => {
      expect(packObjectTypeToString(PackObjectType.OBJ_TREE)).toBe('tree')
    })

    it('should convert blob type to string', () => {
      expect(packObjectTypeToString(PackObjectType.OBJ_BLOB)).toBe('blob')
    })

    it('should convert tag type to string', () => {
      expect(packObjectTypeToString(PackObjectType.OBJ_TAG)).toBe('tag')
    })

    it('should convert ofs_delta type to string', () => {
      expect(packObjectTypeToString(PackObjectType.OBJ_OFS_DELTA)).toBe('ofs_delta')
    })

    it('should convert ref_delta type to string', () => {
      expect(packObjectTypeToString(PackObjectType.OBJ_REF_DELTA)).toBe('ref_delta')
    })

    it('should throw for invalid type', () => {
      expect(() => packObjectTypeToString(0 as PackObjectType)).toThrow()
      expect(() => packObjectTypeToString(5 as PackObjectType)).toThrow()
      expect(() => packObjectTypeToString(8 as PackObjectType)).toThrow()
    })
  })

  describe('stringToPackObjectType', () => {
    it('should convert commit string to type', () => {
      expect(stringToPackObjectType('commit')).toBe(PackObjectType.OBJ_COMMIT)
    })

    it('should convert tree string to type', () => {
      expect(stringToPackObjectType('tree')).toBe(PackObjectType.OBJ_TREE)
    })

    it('should convert blob string to type', () => {
      expect(stringToPackObjectType('blob')).toBe(PackObjectType.OBJ_BLOB)
    })

    it('should convert tag string to type', () => {
      expect(stringToPackObjectType('tag')).toBe(PackObjectType.OBJ_TAG)
    })

    it('should throw for invalid string', () => {
      expect(() => stringToPackObjectType('invalid')).toThrow()
      expect(() => stringToPackObjectType('ofs_delta')).toThrow() // Not valid as input
      expect(() => stringToPackObjectType('ref_delta')).toThrow() // Not valid as input
    })
  })

  describe('Variable-length integer encoding', () => {
    describe('encodeVarint', () => {
      it('should encode single-byte values (0-127)', () => {
        expect(encodeVarint(0)).toEqual(new Uint8Array([0]))
        expect(encodeVarint(1)).toEqual(new Uint8Array([1]))
        expect(encodeVarint(127)).toEqual(new Uint8Array([127]))
      })

      it('should encode two-byte values (128-16383)', () => {
        // 128 = 0x80 -> 0x80 0x01
        expect(encodeVarint(128)).toEqual(new Uint8Array([0x80, 0x01]))
        // 255 = 0xFF -> 0xFF 0x01
        expect(encodeVarint(255)).toEqual(new Uint8Array([0xff, 0x01]))
        // 16383 = 0x3FFF -> 0xFF 0x7F
        expect(encodeVarint(16383)).toEqual(new Uint8Array([0xff, 0x7f]))
      })

      it('should encode three-byte values', () => {
        // 16384 = 0x4000 -> 0x80 0x80 0x01
        expect(encodeVarint(16384)).toEqual(new Uint8Array([0x80, 0x80, 0x01]))
      })

      it('should encode large values', () => {
        const result = encodeVarint(2097152) // 0x200000
        expect(result.length).toBeGreaterThan(2)
      })
    })

    describe('decodeVarint', () => {
      it('should decode single-byte values', () => {
        const data = new Uint8Array([0])
        expect(decodeVarint(data, 0)).toEqual({ value: 0, bytesRead: 1 })

        const data2 = new Uint8Array([127])
        expect(decodeVarint(data2, 0)).toEqual({ value: 127, bytesRead: 1 })
      })

      it('should decode two-byte values', () => {
        const data = new Uint8Array([0x80, 0x01])
        expect(decodeVarint(data, 0)).toEqual({ value: 128, bytesRead: 2 })

        const data2 = new Uint8Array([0xff, 0x7f])
        expect(decodeVarint(data2, 0)).toEqual({ value: 16383, bytesRead: 2 })
      })

      it('should decode from offset', () => {
        const data = new Uint8Array([0xaa, 0xbb, 0x80, 0x01, 0xcc])
        expect(decodeVarint(data, 2)).toEqual({ value: 128, bytesRead: 2 })
      })

      it('should round-trip encode/decode', () => {
        const testValues = [0, 1, 127, 128, 255, 16383, 16384, 2097151, 268435455]
        for (const value of testValues) {
          const encoded = encodeVarint(value)
          const { value: decoded } = decodeVarint(encoded, 0)
          expect(decoded).toBe(value)
        }
      })
    })
  })

  describe('Type and size encoding', () => {
    describe('encodeTypeAndSize', () => {
      it('should encode type and small size in single byte', () => {
        // Type 1 (commit), size 5: (1 << 4) | 5 = 0x15
        const result = encodeTypeAndSize(PackObjectType.OBJ_COMMIT, 5)
        expect(result[0]).toBe(0x15)
        expect(result.length).toBe(1)
      })

      it('should encode type and size up to 15 in single byte', () => {
        // Type 3 (blob), size 15: (3 << 4) | 15 = 0x3F
        const result = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 15)
        expect(result[0]).toBe(0x3f)
        expect(result.length).toBe(1)
      })

      it('should encode larger sizes in multiple bytes', () => {
        // Type 2 (tree), size 16: first byte = 0x80 | (2 << 4) | (16 & 0x0F)
        // = 0x80 | 0x20 | 0x00 = 0xA0, then 16 >> 4 = 1 -> 0x01
        const result = encodeTypeAndSize(PackObjectType.OBJ_TREE, 16)
        expect(result.length).toBe(2)
        expect(result[0] & 0x70).toBe(PackObjectType.OBJ_TREE << 4) // Type bits
      })

      it('should encode very large sizes', () => {
        const result = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 1000000)
        expect(result.length).toBeGreaterThan(2)
      })
    })

    describe('decodeTypeAndSize', () => {
      it('should decode type and small size from single byte', () => {
        const data = new Uint8Array([0x15]) // Type 1, size 5
        const result = decodeTypeAndSize(data, 0)
        expect(result.type).toBe(PackObjectType.OBJ_COMMIT)
        expect(result.size).toBe(5)
        expect(result.bytesRead).toBe(1)
      })

      it('should decode type and larger size from multiple bytes', () => {
        // Encode type 3 (blob), size 100
        const encoded = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 100)
        const result = decodeTypeAndSize(encoded, 0)
        expect(result.type).toBe(PackObjectType.OBJ_BLOB)
        expect(result.size).toBe(100)
      })

      it('should decode from offset', () => {
        const encoded = encodeTypeAndSize(PackObjectType.OBJ_TAG, 50)
        const data = new Uint8Array([0xaa, 0xbb, ...encoded])
        const result = decodeTypeAndSize(data, 2)
        expect(result.type).toBe(PackObjectType.OBJ_TAG)
        expect(result.size).toBe(50)
      })

      it('should round-trip encode/decode for various types and sizes', () => {
        const types = [
          PackObjectType.OBJ_COMMIT,
          PackObjectType.OBJ_TREE,
          PackObjectType.OBJ_BLOB,
          PackObjectType.OBJ_TAG
        ]
        const sizes = [0, 1, 15, 16, 127, 128, 1000, 65535, 1000000]

        for (const type of types) {
          for (const size of sizes) {
            const encoded = encodeTypeAndSize(type, size)
            const decoded = decodeTypeAndSize(encoded, 0)
            expect(decoded.type).toBe(type)
            expect(decoded.size).toBe(size)
          }
        }
      })
    })
  })

  describe('parsePackHeader', () => {
    it('should parse valid pack header', () => {
      // PACK signature (4 bytes) + version 2 (4 bytes BE) + object count (4 bytes BE)
      const header = new Uint8Array([
        0x50, 0x41, 0x43, 0x4b, // PACK
        0x00, 0x00, 0x00, 0x02, // version 2
        0x00, 0x00, 0x00, 0x05  // 5 objects
      ])
      const result = parsePackHeader(header)
      expect(result.signature).toBe('PACK')
      expect(result.version).toBe(2)
      expect(result.objectCount).toBe(5)
    })

    it('should parse header with large object count', () => {
      const header = new Uint8Array([
        0x50, 0x41, 0x43, 0x4b, // PACK
        0x00, 0x00, 0x00, 0x02, // version 2
        0x00, 0x01, 0x00, 0x00  // 65536 objects
      ])
      const result = parsePackHeader(header)
      expect(result.objectCount).toBe(65536)
    })

    it('should throw for invalid signature', () => {
      const header = new Uint8Array([
        0x50, 0x41, 0x43, 0x00, // Invalid - PAC\0
        0x00, 0x00, 0x00, 0x02,
        0x00, 0x00, 0x00, 0x01
      ])
      expect(() => parsePackHeader(header)).toThrow(/signature/i)
    })

    it('should throw for unsupported version', () => {
      const header = new Uint8Array([
        0x50, 0x41, 0x43, 0x4b, // PACK
        0x00, 0x00, 0x00, 0x03, // version 3 (unsupported)
        0x00, 0x00, 0x00, 0x01
      ])
      expect(() => parsePackHeader(header)).toThrow(/version/i)
    })

    it('should throw for truncated header', () => {
      const header = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
      expect(() => parsePackHeader(header)).toThrow()
    })
  })

  describe('parsePackObject', () => {
    it('should parse a simple blob object', () => {
      // Create a pack object: type=blob(3), size=5, data="hello" (zlib compressed)
      const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 5)
      // Zlib compressed "hello" - using deflate raw
      // For testing, we'll use a mock or the actual zlib
      const result = parsePackObject(typeAndSize, 0)
      expect(result.type).toBe(PackObjectType.OBJ_BLOB)
      expect(result.size).toBe(5)
    })

    it('should correctly identify object type', () => {
      const commitHeader = encodeTypeAndSize(PackObjectType.OBJ_COMMIT, 100)
      const treeHeader = encodeTypeAndSize(PackObjectType.OBJ_TREE, 50)
      const blobHeader = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 25)
      const tagHeader = encodeTypeAndSize(PackObjectType.OBJ_TAG, 75)

      expect(parsePackObject(commitHeader, 0).type).toBe(PackObjectType.OBJ_COMMIT)
      expect(parsePackObject(treeHeader, 0).type).toBe(PackObjectType.OBJ_TREE)
      expect(parsePackObject(blobHeader, 0).type).toBe(PackObjectType.OBJ_BLOB)
      expect(parsePackObject(tagHeader, 0).type).toBe(PackObjectType.OBJ_TAG)
    })

    it('should parse ofs_delta object header', () => {
      const header = encodeTypeAndSize(PackObjectType.OBJ_OFS_DELTA, 100)
      const result = parsePackObject(header, 0)
      expect(result.type).toBe(PackObjectType.OBJ_OFS_DELTA)
    })

    it('should parse ref_delta object header', () => {
      const header = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, 100)
      const result = parsePackObject(header, 0)
      expect(result.type).toBe(PackObjectType.OBJ_REF_DELTA)
    })
  })

  describe('createPackfile', () => {
    it('should create a valid packfile with single object', () => {
      const objects = [
        { type: 'blob' as const, data: encoder.encode('hello') }
      ]
      const packfile = createPackfile(objects)

      // Verify header
      const header = parsePackHeader(packfile)
      expect(header.signature).toBe('PACK')
      expect(header.version).toBe(2)
      expect(header.objectCount).toBe(1)
    })

    it('should create packfile with multiple objects', () => {
      const objects = [
        { type: 'blob' as const, data: encoder.encode('hello') },
        { type: 'blob' as const, data: encoder.encode('world') },
        { type: 'blob' as const, data: encoder.encode('test content') }
      ]
      const packfile = createPackfile(objects)

      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(3)
    })

    it('should create packfile with different object types', () => {
      const treeData = new Uint8Array([0x31, 0x30, 0x30, 0x36, 0x34, 0x34]) // Minimal tree-like data
      const objects = [
        { type: 'blob' as const, data: encoder.encode('content') },
        { type: 'tree' as const, data: treeData },
        { type: 'commit' as const, data: encoder.encode('tree abc\nauthor x <x@x> 1 +0\n\nmsg') }
      ]
      const packfile = createPackfile(objects)

      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(3)
    })

    it('should create empty packfile', () => {
      const objects: { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }[] = []
      const packfile = createPackfile(objects)

      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(0)
    })

    it('should include SHA-1 checksum at end', () => {
      const objects = [
        { type: 'blob' as const, data: encoder.encode('test') }
      ]
      const packfile = createPackfile(objects)

      // Last 20 bytes should be SHA-1 checksum
      expect(packfile.length).toBeGreaterThan(20)
      const checksum = packfile.slice(-20)
      expect(checksum.length).toBe(20)
    })

    it('should create packfile with large object', () => {
      const largeContent = new Uint8Array(100000)
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256
      }
      const objects = [
        { type: 'blob' as const, data: largeContent }
      ]
      const packfile = createPackfile(objects)

      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(1)
    })

    it('should compress object data', () => {
      // Create a highly compressible object
      const repeatContent = new Uint8Array(10000).fill(0x41) // 'A' repeated
      const objects = [
        { type: 'blob' as const, data: repeatContent }
      ]
      const packfile = createPackfile(objects)

      // Packfile should be significantly smaller than raw data + header
      expect(packfile.length).toBeLessThan(repeatContent.length)
    })
  })

  describe('Integration Tests', () => {
    it('should create and parse packfile header consistently', () => {
      const objects = [
        { type: 'blob' as const, data: encoder.encode('content1') },
        { type: 'blob' as const, data: encoder.encode('content2') }
      ]
      const packfile = createPackfile(objects)
      const header = parsePackHeader(packfile)

      expect(header.signature).toBe('PACK')
      expect(header.version).toBe(2)
      expect(header.objectCount).toBe(objects.length)
    })

    it('should handle objects with null bytes', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0xff])
      const objects = [
        { type: 'blob' as const, data: binaryData }
      ]
      const packfile = createPackfile(objects)

      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(1)
    })

    it('should handle unicode content', () => {
      const unicodeContent = encoder.encode('Hello World!')
      const objects = [
        { type: 'blob' as const, data: unicodeContent }
      ]
      const packfile = createPackfile(objects)

      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero-length blob', () => {
      const objects = [
        { type: 'blob' as const, data: new Uint8Array(0) }
      ]
      const packfile = createPackfile(objects)
      const header = parsePackHeader(packfile)
      expect(header.objectCount).toBe(1)
    })

    it('should encode type correctly in first byte', () => {
      // First byte format: MSB continuation bit, 3 bits type, 4 bits size
      const encoded = encodeTypeAndSize(PackObjectType.OBJ_COMMIT, 0)
      expect((encoded[0] >> 4) & 0x07).toBe(PackObjectType.OBJ_COMMIT)
    })

    it('should handle maximum single-byte size (15)', () => {
      const encoded = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 15)
      expect(encoded.length).toBe(1)
      expect(encoded[0] & 0x0f).toBe(15)
    })

    it('should handle minimum multi-byte size (16)', () => {
      const encoded = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 16)
      expect(encoded.length).toBe(2)
      expect(encoded[0] & 0x80).toBe(0x80) // Continuation bit set
    })
  })
})
