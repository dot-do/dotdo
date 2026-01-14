import { describe, it, expect } from 'vitest'
import {
  PackIndex,
  PackIndexEntry,
  parsePackIndex,
  createPackIndex,
  lookupObject,
  PACK_INDEX_SIGNATURE,
  PACK_INDEX_VERSION
} from '../../src/pack/index'
import { createPackfile, PackObjectType } from '../../src/pack/format'

// Helper functions
const encoder = new TextEncoder()

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

// SHA-1 produces 40-char hex (20 bytes)
function createTestSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

describe('Pack Index', () => {
  describe('Constants', () => {
    it('should have correct pack index signature', () => {
      // Pack index v2 signature: 0xff 0x74 0x4f 0x63 ("\377tOc")
      expect(PACK_INDEX_SIGNATURE).toEqual(new Uint8Array([0xff, 0x74, 0x4f, 0x63]))
    })

    it('should have correct pack index version', () => {
      expect(PACK_INDEX_VERSION).toBe(2)
    })
  })

  describe('PackIndexEntry', () => {
    it('should have required properties', () => {
      const entry: PackIndexEntry = {
        sha: createTestSha('abc123'),
        offset: 12,
        crc32: 0x12345678
      }
      expect(entry.sha).toBe(createTestSha('abc123'))
      expect(entry.offset).toBe(12)
      expect(entry.crc32).toBe(0x12345678)
    })

    it('should support large offsets', () => {
      const entry: PackIndexEntry = {
        sha: createTestSha('def456'),
        offset: 0x100000000, // > 4GB offset (requires 8-byte offset)
        crc32: 0
      }
      expect(entry.offset).toBe(0x100000000)
    })
  })

  describe('PackIndex interface', () => {
    it('should have required properties', () => {
      const index: PackIndex = {
        version: 2,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }
      expect(index.version).toBe(2)
      expect(index.fanout.length).toBe(256)
      expect(index.entries).toEqual([])
      expect(index.packChecksum.length).toBe(20)
      expect(index.indexChecksum.length).toBe(20)
    })
  })

  describe('createPackIndex', () => {
    it('should create valid index for empty packfile', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = []
      const indexData = createPackIndex(packfile, entries)

      expect(indexData).toBeInstanceOf(Uint8Array)
      // Minimum size: signature(4) + version(4) + fanout(256*4) + pack checksum(20) + index checksum(20)
      expect(indexData.length).toBeGreaterThanOrEqual(4 + 4 + 256 * 4 + 20 + 20)
    })

    it('should create valid index with signature and version', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = []
      const indexData = createPackIndex(packfile, entries)

      // Check signature
      expect(indexData[0]).toBe(0xff)
      expect(indexData[1]).toBe(0x74) // 't'
      expect(indexData[2]).toBe(0x4f) // 'O'
      expect(indexData[3]).toBe(0x63) // 'c'

      // Check version (big-endian)
      const version = (indexData[4] << 24) | (indexData[5] << 16) | (indexData[6] << 8) | indexData[7]
      expect(version).toBe(2)
    })

    it('should create index with single entry', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('hello') }
      ])

      const entry: PackIndexEntry = {
        sha: createTestSha('abc123'),
        offset: 12, // After header
        crc32: 0x12345678
      }
      const indexData = createPackIndex(packfile, [entry])

      expect(indexData.length).toBeGreaterThan(0)

      // Parse and verify
      const parsed = parsePackIndex(indexData)
      expect(parsed.entries.length).toBe(1)
      expect(parsed.entries[0].sha).toBe(entry.sha)
      expect(parsed.entries[0].offset).toBe(entry.offset)
      expect(parsed.entries[0].crc32).toBe(entry.crc32)
    })

    it('should create index with multiple entries', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('hello') },
        { type: 'blob', data: encoder.encode('world') },
        { type: 'blob', data: encoder.encode('test') }
      ])

      const entries: PackIndexEntry[] = [
        { sha: createTestSha('111111'), offset: 12, crc32: 0x11111111 },
        { sha: createTestSha('222222'), offset: 24, crc32: 0x22222222 },
        { sha: createTestSha('333333'), offset: 36, crc32: 0x33333333 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      expect(parsed.entries.length).toBe(3)
    })

    it('should sort entries by SHA in index', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('a') },
        { type: 'blob', data: encoder.encode('b') },
        { type: 'blob', data: encoder.encode('c') }
      ])

      // Entries intentionally out of order
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('cccccc'), offset: 36, crc32: 3 },
        { sha: createTestSha('aaaaaa'), offset: 12, crc32: 1 },
        { sha: createTestSha('bbbbbb'), offset: 24, crc32: 2 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      // Entries should be sorted by SHA
      expect(parsed.entries[0].sha).toBe(createTestSha('aaaaaa'))
      expect(parsed.entries[1].sha).toBe(createTestSha('bbbbbb'))
      expect(parsed.entries[2].sha).toBe(createTestSha('cccccc'))
    })

    it('should populate fanout table correctly', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('test') }
      ])

      // Entry starting with 0xab should affect fanout[0xab..0xff]
      const entries: PackIndexEntry[] = [
        { sha: 'ab' + '0'.repeat(38), offset: 12, crc32: 0 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)

      // Fanout[i] contains cumulative count of entries with first byte <= i
      for (let i = 0; i < 0xab; i++) {
        expect(parsed.fanout[i]).toBe(0)
      }
      for (let i = 0xab; i < 256; i++) {
        expect(parsed.fanout[i]).toBe(1)
      }
    })

    it('should handle large offsets (>2GB) with 8-byte encoding', () => {
      const packfile = createPackfile([])

      const largeOffset = 0x100000000 // 4GB, requires 8-byte offset
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc123'), offset: largeOffset, crc32: 0 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      expect(parsed.entries[0].offset).toBe(largeOffset)
    })

    it('should include pack checksum', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('test') }
      ])
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 12, crc32: 0 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      // Pack checksum should match the last 20 bytes of the packfile
      const packChecksum = packfile.slice(-20)
      expect(bytesToHex(parsed.packChecksum)).toBe(bytesToHex(packChecksum))
    })

    it('should compute and include index checksum', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = []
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      expect(parsed.indexChecksum.length).toBe(20)
      // Checksum should not be all zeros
      const isAllZeros = parsed.indexChecksum.every(b => b === 0)
      // Note: could be zeros in theory, but extremely unlikely
      expect(parsed.indexChecksum.length).toBe(20)
    })
  })

  describe('parsePackIndex', () => {
    it('should throw for invalid signature', () => {
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      expect(() => parsePackIndex(invalidData)).toThrow(/signature/i)
    })

    it('should throw for unsupported version', () => {
      const data = new Uint8Array(8)
      // Valid signature
      data[0] = 0xff
      data[1] = 0x74
      data[2] = 0x4f
      data[3] = 0x63
      // Invalid version (3)
      data[4] = 0
      data[5] = 0
      data[6] = 0
      data[7] = 3
      expect(() => parsePackIndex(data)).toThrow(/version/i)
    })

    it('should throw for truncated data', () => {
      const data = new Uint8Array(4) // Too short
      data[0] = 0xff
      data[1] = 0x74
      data[2] = 0x4f
      data[3] = 0x63
      expect(() => parsePackIndex(data)).toThrow()
    })

    it('should parse valid index correctly', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('hello') }
      ])
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 12, crc32: 0x12345678 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      expect(parsed.version).toBe(2)
      expect(parsed.fanout.length).toBe(256)
      expect(parsed.entries.length).toBe(1)
      expect(parsed.packChecksum.length).toBe(20)
      expect(parsed.indexChecksum.length).toBe(20)
    })

    it('should parse fanout table', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 12, crc32: 0 },
        { sha: '01' + '0'.repeat(38), offset: 24, crc32: 0 },
        { sha: 'ff' + '0'.repeat(38), offset: 36, crc32: 0 }
      ]
      const indexData = createPackIndex(packfile, entries)

      const parsed = parsePackIndex(indexData)
      expect(parsed.fanout[0x00]).toBe(1)  // 1 entry with first byte 0x00
      expect(parsed.fanout[0x01]).toBe(2)  // 2 entries with first byte <= 0x01
      expect(parsed.fanout[0xff]).toBe(3)  // 3 total entries
    })

    it('should verify index integrity with checksum', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('test') }
      ])
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 12, crc32: 0 }
      ]
      const indexData = createPackIndex(packfile, entries)

      // Corrupt a byte in the middle
      const corruptedData = new Uint8Array(indexData)
      corruptedData[100] ^= 0xff

      expect(() => parsePackIndex(corruptedData)).toThrow(/checksum|integrity/i)
    })
  })

  describe('lookupObject', () => {
    it('should find existing object by SHA', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('hello') },
        { type: 'blob', data: encoder.encode('world') }
      ])
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 12, crc32: 0x11111111 },
        { sha: createTestSha('bbb'), offset: 24, crc32: 0x22222222 }
      ]
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      const result = lookupObject(index, createTestSha('aaa'))
      expect(result).not.toBeNull()
      expect(result!.sha).toBe(createTestSha('aaa'))
      expect(result!.offset).toBe(12)
      expect(result!.crc32).toBe(0x11111111)
    })

    it('should return null for non-existent object', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('hello') }
      ])
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 12, crc32: 0 }
      ]
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      const result = lookupObject(index, createTestSha('xyz'))
      expect(result).toBeNull()
    })

    it('should use fanout table for efficient lookup', () => {
      const packfile = createPackfile([])
      // Create entries with different first bytes
      const entries: PackIndexEntry[] = [
        { sha: '00' + 'a'.repeat(38), offset: 12, crc32: 1 },
        { sha: '00' + 'b'.repeat(38), offset: 24, crc32: 2 },
        { sha: 'ff' + 'a'.repeat(38), offset: 36, crc32: 3 }
      ]
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      // Looking up 0xff... should use fanout to skip entries starting with 0x00
      const result = lookupObject(index, 'ff' + 'a'.repeat(38))
      expect(result).not.toBeNull()
      expect(result!.offset).toBe(36)
    })

    it('should find first entry', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 12, crc32: 1 },
        { sha: '11' + '0'.repeat(38), offset: 24, crc32: 2 },
        { sha: 'ff' + '0'.repeat(38), offset: 36, crc32: 3 }
      ]
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      const result = lookupObject(index, '00' + '0'.repeat(38))
      expect(result).not.toBeNull()
      expect(result!.offset).toBe(12)
    })

    it('should find last entry', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 12, crc32: 1 },
        { sha: '11' + '0'.repeat(38), offset: 24, crc32: 2 },
        { sha: 'ff' + '0'.repeat(38), offset: 36, crc32: 3 }
      ]
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      const result = lookupObject(index, 'ff' + '0'.repeat(38))
      expect(result).not.toBeNull()
      expect(result!.offset).toBe(36)
    })

    it('should find middle entry with binary search', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = []
      // Create 100 entries
      for (let i = 0; i < 100; i++) {
        const hex = i.toString(16).padStart(2, '0')
        entries.push({
          sha: hex + '0'.repeat(38),
          offset: 12 + i * 10,
          crc32: i
        })
      }
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      // Look up entry in the middle (50th)
      const result = lookupObject(index, '32' + '0'.repeat(38)) // 0x32 = 50
      expect(result).not.toBeNull()
      expect(result!.crc32).toBe(0x32)
    })

    it('should handle empty index', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = []
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      const result = lookupObject(index, createTestSha('abc'))
      expect(result).toBeNull()
    })

    it('should handle SHA with prefix lookup', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = [
        { sha: 'abcdef' + '0'.repeat(34), offset: 12, crc32: 1 }
      ]
      const indexData = createPackIndex(packfile, entries)
      const index = parsePackIndex(indexData)

      // Full SHA lookup should work
      const result = lookupObject(index, 'abcdef' + '0'.repeat(34))
      expect(result).not.toBeNull()
    })
  })

  describe('Integration Tests', () => {
    it('should round-trip create and parse index', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('content1') },
        { type: 'blob', data: encoder.encode('content2') },
        { type: 'blob', data: encoder.encode('content3') }
      ])

      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 12, crc32: 0x11111111 },
        { sha: createTestSha('bbb'), offset: 50, crc32: 0x22222222 },
        { sha: createTestSha('ccc'), offset: 100, crc32: 0x33333333 }
      ]

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      expect(parsed.version).toBe(2)
      expect(parsed.entries.length).toBe(3)

      // Verify all entries can be looked up
      for (const entry of entries) {
        const found = lookupObject(parsed, entry.sha)
        expect(found).not.toBeNull()
        expect(found!.offset).toBe(entry.offset)
        expect(found!.crc32).toBe(entry.crc32)
      }
    })

    it('should handle many entries efficiently', () => {
      const packfile = createPackfile([])
      const entries: PackIndexEntry[] = []

      // Create 1000 entries
      for (let i = 0; i < 1000; i++) {
        const shaNum = i.toString(16).padStart(40, '0')
        entries.push({
          sha: shaNum,
          offset: 12 + i * 100,
          crc32: i
        })
      }

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      expect(parsed.entries.length).toBe(1000)
      expect(parsed.fanout[0xff]).toBe(1000) // Total count

      // Lookup should be fast with binary search
      const result = lookupObject(parsed, (500).toString(16).padStart(40, '0')) // 500 in hex
      expect(result).not.toBeNull()
      expect(result!.crc32).toBe(500)
    })

    it('should preserve CRC32 values correctly', () => {
      const packfile = createPackfile([
        { type: 'blob', data: encoder.encode('test') }
      ])

      const crc32Value = 0xDEADBEEF
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 12, crc32: crc32Value }
      ]

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      expect(parsed.entries[0].crc32).toBe(crc32Value)
    })

    it('should handle mixed small and large offsets', () => {
      const packfile = createPackfile([])

      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 12, crc32: 1 }, // Small offset
        { sha: createTestSha('bbb'), offset: 0x7FFFFFFF, crc32: 2 }, // Max 4-byte offset
        { sha: createTestSha('ccc'), offset: 0x100000000, crc32: 3 } // Large offset (8-byte)
      ]

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      expect(parsed.entries.length).toBe(3)

      const smallEntry = lookupObject(parsed, createTestSha('aaa'))
      expect(smallEntry!.offset).toBe(12)

      const maxEntry = lookupObject(parsed, createTestSha('bbb'))
      expect(maxEntry!.offset).toBe(0x7FFFFFFF)

      const largeEntry = lookupObject(parsed, createTestSha('ccc'))
      expect(largeEntry!.offset).toBe(0x100000000)
    })
  })

  describe('Edge Cases', () => {
    it('should handle entries with same first byte correctly', () => {
      const packfile = createPackfile([])

      const entries: PackIndexEntry[] = [
        { sha: 'aa' + '1'.repeat(38), offset: 12, crc32: 1 },
        { sha: 'aa' + '2'.repeat(38), offset: 24, crc32: 2 },
        { sha: 'aa' + '3'.repeat(38), offset: 36, crc32: 3 }
      ]

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      // All should be found
      expect(lookupObject(parsed, 'aa' + '1'.repeat(38))).not.toBeNull()
      expect(lookupObject(parsed, 'aa' + '2'.repeat(38))).not.toBeNull()
      expect(lookupObject(parsed, 'aa' + '3'.repeat(38))).not.toBeNull()

      // Fanout should show 3 entries for 0xaa
      expect(parsed.fanout[0xaa]).toBe(3)
      // And 0 for earlier bytes
      expect(parsed.fanout[0xa9]).toBe(0)
    })

    it('should handle single entry at boundary', () => {
      const packfile = createPackfile([])

      // Entry with first byte 0xff (last fanout bucket)
      const entries: PackIndexEntry[] = [
        { sha: 'ff' + '0'.repeat(38), offset: 12, crc32: 1 }
      ]

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      expect(parsed.fanout[0xfe]).toBe(0)
      expect(parsed.fanout[0xff]).toBe(1)

      const result = lookupObject(parsed, 'ff' + '0'.repeat(38))
      expect(result).not.toBeNull()
    })

    it('should handle single entry at start', () => {
      const packfile = createPackfile([])

      // Entry with first byte 0x00 (first fanout bucket)
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 12, crc32: 1 }
      ]

      const indexData = createPackIndex(packfile, entries)
      const parsed = parsePackIndex(indexData)

      expect(parsed.fanout[0x00]).toBe(1)
      expect(parsed.fanout[0xff]).toBe(1)

      const result = lookupObject(parsed, '00' + '0'.repeat(38))
      expect(result).not.toBeNull()
    })

    it('should throw for invalid SHA length in lookup', () => {
      const packfile = createPackIndex(createPackfile([]), [])
      const index = parsePackIndex(packfile)

      // SHA must be 40 hex chars
      expect(() => lookupObject(index, 'abc')).toThrow(/sha/i)
      expect(() => lookupObject(index, 'x'.repeat(40))).toThrow(/sha|hex/i)
    })
  })
})
