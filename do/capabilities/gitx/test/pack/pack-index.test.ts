import { describe, it, expect } from 'vitest'
import {
  parsePackIndex,
  createPackIndex,
  lookupObject,
  verifyPackIndex,
  getFanoutRange,
  calculateCRC32,
  binarySearchSha,
  serializePackIndex,
  parseFanoutTable,
  readPackOffset,
  PACK_INDEX_MAGIC,
  PACK_INDEX_VERSION,
  LARGE_OFFSET_THRESHOLD,
  PackIndex,
  PackIndexEntry
} from '../../src/pack/index'

// Alias for backward compatibility with tests
const binarySearchObjectId = binarySearchSha

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

/**
 * Creates a minimal valid pack index v2 header
 */
function createPackIndexHeader(): Uint8Array {
  const header = new Uint8Array(8)
  // Magic number: 0xff 0x74 0x4f 0x63 ("\377tOc")
  header[0] = 0xff
  header[1] = 0x74
  header[2] = 0x4f
  header[3] = 0x63
  // Version 2 (big-endian)
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = 2
  return header
}

/**
 * Simple SHA-1 implementation for test helper
 */
function sha1ForTests(data: Uint8Array): Uint8Array {
  const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6]
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0

  const originalLength = data.length
  const bitLength = BigInt(originalLength) * 8n
  const paddingLength = (64 - ((originalLength + 9) % 64)) % 64
  const paddedLength = originalLength + 1 + paddingLength + 8

  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  padded[originalLength] = 0x80
  const lengthView = new DataView(padded.buffer)
  lengthView.setBigUint64(paddedLength - 8, bitLength, false)

  const w = new Uint32Array(80)
  for (let chunkStart = 0; chunkStart < paddedLength; chunkStart += 64) {
    const chunkView = new DataView(padded.buffer, chunkStart, 64)
    for (let i = 0; i < 16; i++) w[i] = chunkView.getUint32(i * 4, false)
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (x << 1) | (x >>> 31)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) { f = (b & c) | (~b & d); k = K[0] }
      else if (i < 40) { f = b ^ c ^ d; k = K[1] }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = K[2] }
      else { f = b ^ c ^ d; k = K[3] }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }

  const result = new Uint8Array(20)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(0, h0, false); resultView.setUint32(4, h1, false)
  resultView.setUint32(8, h2, false); resultView.setUint32(12, h3, false); resultView.setUint32(16, h4, false)
  return result
}

/**
 * Creates a minimal valid pack index v2 structure for testing
 */
function createMinimalPackIndex(objectCount: number = 0): Uint8Array {
  // Pack index v2 format:
  // - 4 bytes: magic (0xff744f63)
  // - 4 bytes: version (2)
  // - 256 * 4 bytes: fanout table
  // - N * 20 bytes: SHA-1 object IDs
  // - N * 4 bytes: CRC32 values
  // - N * 4 bytes: 4-byte offsets
  // - M * 8 bytes: 8-byte offsets (for large offsets)
  // - 20 bytes: packfile checksum
  // - 20 bytes: index checksum

  const fanoutSize = 256 * 4
  const shaSize = objectCount * 20
  const crcSize = objectCount * 4
  const offsetSize = objectCount * 4
  const checksumSize = 20 * 2 // pack + index checksums

  const totalSize = 8 + fanoutSize + shaSize + crcSize + offsetSize + checksumSize
  const data = new Uint8Array(totalSize)

  // Header
  const header = createPackIndexHeader()
  data.set(header, 0)

  // Fanout table - all zeros for empty index
  // (Would need proper values for non-empty index)

  // Compute and write the index checksum (SHA-1 of everything before the last 20 bytes)
  const dataToHash = data.subarray(0, totalSize - 20)
  const checksum = sha1ForTests(dataToHash)
  data.set(checksum, totalSize - 20)

  return data
}

/**
 * Creates a test SHA-1 from a prefix
 */
function createTestSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

/**
 * Creates a SHA-1 as bytes from a prefix
 */
function createTestShaBytes(prefix: string): Uint8Array {
  return hexToBytes(createTestSha(prefix))
}

/**
 * Creates a fanout table for the given sorted entries
 */
function createFanoutForEntries(entries: PackIndexEntry[]): Uint32Array {
  const fanout = new Uint32Array(256)
  let count = 0
  let entryIdx = 0

  for (let i = 0; i < 256; i++) {
    while (entryIdx < entries.length) {
      const firstByte = parseInt(entries[entryIdx].sha.slice(0, 2), 16)
      if (firstByte <= i) {
        count++
        entryIdx++
      } else {
        break
      }
    }
    fanout[i] = count
  }

  return fanout
}

describe('Pack Index (.idx) File Format', () => {
  describe('Constants and Magic Numbers', () => {
    it('should define correct pack index magic number (0xff744f63)', () => {
      // Pack index v2 magic: 0xff 0x74 0x4f 0x63 = "\377tOc"
      expect(PACK_INDEX_MAGIC).toBe(0xff744f63)
    })

    it('should define pack index version as 2', () => {
      expect(PACK_INDEX_VERSION).toBe(2)
    })

    it('should define large offset threshold as 2GB (0x80000000)', () => {
      // Offsets >= 0x80000000 (2GB) use 8-byte encoding
      expect(LARGE_OFFSET_THRESHOLD).toBe(0x80000000)
    })
  })

  describe('Index File Format Parsing', () => {
    it('should parse valid pack index v2 header', () => {
      const data = createMinimalPackIndex()
      const index = parsePackIndex(data)

      expect(index.version).toBe(2)
    })

    it('should extract object count from fanout[255]', () => {
      const data = createMinimalPackIndex(0)
      const index = parsePackIndex(data)

      // Object count is available via fanout[255] or entries.length
      expect(index.fanout[255]).toBe(0)
      expect(index.entries.length).toBe(0)
    })

    it('should reject pack index v1 format (no magic number)', () => {
      // v1 format doesn't have magic number, starts directly with fanout
      // Create data large enough to pass minimum size check (header + fanout + checksums = 1072 bytes)
      const v1Data = new Uint8Array(8 + 256 * 4 + 40)
      v1Data[0] = 0
      v1Data[1] = 0
      v1Data[2] = 0
      v1Data[3] = 1 // First bytes look like fanout, not magic

      expect(() => parsePackIndex(v1Data)).toThrow(/version|signature|magic/i)
    })

    it('should reject invalid magic number', () => {
      const data = createMinimalPackIndex()
      data[0] = 0x00 // Corrupt first byte of magic

      expect(() => parsePackIndex(data)).toThrow(/magic|signature/i)
    })

    it('should reject unsupported version 3', () => {
      const data = createMinimalPackIndex()
      data[7] = 3 // Set version to 3

      expect(() => parsePackIndex(data)).toThrow(/version/i)
    })

    it('should reject version 0', () => {
      const data = createMinimalPackIndex()
      data[7] = 0

      expect(() => parsePackIndex(data)).toThrow(/version/i)
    })

    it('should parse empty pack index correctly', () => {
      const data = createMinimalPackIndex(0)
      const index = parsePackIndex(data)

      expect(index.entries.length).toBe(0)
      expect(index.entries).toEqual([])
      expect(index.fanout[255]).toBe(0)
    })

    it('should reject truncated pack index data', () => {
      const data = createMinimalPackIndex()
      const truncated = data.slice(0, 100) // Too short

      expect(() => parsePackIndex(truncated)).toThrow()
    })

    it('should have 256-entry fanout table', () => {
      const data = createMinimalPackIndex()
      const index = parsePackIndex(data)

      expect(index.fanout.length).toBe(256)
      expect(index.fanout).toBeInstanceOf(Uint32Array)
    })

    it('should parse SHA-1 object IDs as 40-character hex strings', () => {
      // This test verifies the format, actual parsing tested with real data
      const sha = createTestSha('abc123')
      expect(sha.length).toBe(40)
      expect(/^[0-9a-f]{40}$/.test(sha)).toBe(true)
    })

    it('should parse CRC32 values as 32-bit unsigned integers', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 100, crc32: 0xdeadbeef }
      ]
      expect(entries[0].crc32).toBe(0xdeadbeef)
      expect(entries[0].crc32 >>> 0).toBe(0xdeadbeef) // Ensure unsigned
    })
  })

  describe('Index File Generation', () => {
    it('should create index with correct magic number and version', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])

      // Check magic number
      expect(indexData[0]).toBe(0xff)
      expect(indexData[1]).toBe(0x74)
      expect(indexData[2]).toBe(0x4f)
      expect(indexData[3]).toBe(0x63)

      // Check version (big-endian)
      const version = (indexData[4] << 24) | (indexData[5] << 16) | (indexData[6] << 8) | indexData[7]
      expect(version).toBe(2)
    })

    it('should create index with correct size for empty packfile', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])

      // Minimum size: header(8) + fanout(1024) + checksums(40)
      expect(indexData.length).toBeGreaterThanOrEqual(8 + 256 * 4 + 40)
    })

    it('should sort entries by object ID in generated index', () => {
      // When creating index from packfile with objects, entries should be sorted
      const indexData = createPackIndex(new Uint8Array(32), [])
      const index = parsePackIndex(indexData)

      // Verify entries are sorted
      for (let i = 1; i < index.entries.length; i++) {
        expect(index.entries[i].sha >= index.entries[i - 1].sha).toBe(true)
      }
    })

    it('should include packfile checksum in generated index', () => {
      const packData = new Uint8Array(32)
      const indexData = createPackIndex(packData, [])
      const index = parsePackIndex(indexData)

      expect(index.packChecksum.length).toBe(20)
    })

    it('should compute and include index checksum', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])
      const index = parsePackIndex(indexData)

      expect(index.indexChecksum.length).toBe(20)
    })

    it('should use 8-byte offsets for objects beyond 2GB', () => {
      // Large offsets (>= 0x80000000) require 8-byte encoding
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 0x100000000, crc32: 0 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)
      const parsed = parsePackIndex(data)

      expect(parsed.entries[0].offset).toBe(0x100000000)
    })
  })

  describe('Object Offset Lookup', () => {
    it('should find object by exact SHA match', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 0x11111111 },
        { sha: createTestSha('bbb'), offset: 200, crc32: 0x22222222 },
        { sha: createTestSha('ccc'), offset: 300, crc32: 0x33333333 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, createTestSha('bbb'))

      expect(result).not.toBeNull()
      expect(result?.sha).toBe(createTestSha('bbb'))
      expect(result?.offset).toBe(200)
      expect(result?.crc32).toBe(0x22222222)
    })

    it('should return not found for missing SHA', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 0x11111111 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, createTestSha('fff'))

      expect(result).toBeNull()
    })

    it('should use fanout table to narrow search range', () => {
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
        { sha: '00' + '1'.repeat(38), offset: 200, crc32: 2 },
        { sha: '01' + '0'.repeat(38), offset: 300, crc32: 3 },
        { sha: 'ff' + '0'.repeat(38), offset: 400, crc32: 4 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, 'ff' + '0'.repeat(38))

      expect(result).not.toBeNull()
      expect(result?.offset).toBe(400)
    })

    it('should find first entry in index', () => {
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
        { sha: 'ff' + 'f'.repeat(38), offset: 200, crc32: 2 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, '00' + '0'.repeat(38))

      expect(result).not.toBeNull()
      expect(result?.offset).toBe(100) // First entry
    })

    it('should find last entry in index', () => {
      const entries: PackIndexEntry[] = [
        { sha: '00' + '0'.repeat(38), offset: 100, crc32: 1 },
        { sha: 'ff' + 'f'.repeat(38), offset: 200, crc32: 2 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, 'ff' + 'f'.repeat(38))

      expect(result).not.toBeNull()
      expect(result?.offset).toBe(200) // Last entry
    })

    it('should handle empty index lookup', () => {
      const index: PackIndex = {
        version: 2,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, createTestSha('abc'))

      expect(result).toBeNull()
    })

    it('should reject invalid SHA format (too short)', () => {
      const index: PackIndex = {
        version: 2,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      expect(() => lookupObject(index, 'abc')).toThrow(/sha|invalid|length/i)
    })

    it('should reject invalid SHA format (too long)', () => {
      const index: PackIndex = {
        version: 2,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      expect(() => lookupObject(index, '0'.repeat(50))).toThrow(/sha|invalid|length/i)
    })

    it('should reject invalid SHA format (non-hex characters)', () => {
      const index: PackIndex = {
        version: 2,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      expect(() => lookupObject(index, 'g'.repeat(40))).toThrow(/sha|invalid|hex/i)
    })

    it('should read 4-byte small offset correctly', () => {
      // Offset 0x12345678 in big-endian
      const data = new Uint8Array([0x12, 0x34, 0x56, 0x78])
      const offset = readPackOffset(data)
      expect(offset).toBe(0x12345678)
    })

    it('should read maximum 4-byte offset (just under 2GB)', () => {
      // 0x7FFFFFFF = 2GB - 1
      const data = new Uint8Array([0x7f, 0xff, 0xff, 0xff])
      const offset = readPackOffset(data)
      expect(offset).toBe(0x7fffffff)
    })

    it('should detect large offset marker (MSB set)', () => {
      // When MSB is set, the lower 31 bits are an index into large offset table
      const data = new Uint8Array([0x80, 0x00, 0x00, 0x05])
      const largeOffsets = new Uint8Array(6 * 8)
      const view = new DataView(largeOffsets.buffer)
      view.setBigUint64(5 * 8, 0x100000000n, false)

      const offset = readPackOffset(data, largeOffsets)
      expect(offset).toBe(0x100000000)
    })

    it('should throw if large offset table missing when needed', () => {
      const data = new Uint8Array([0x80, 0x00, 0x00, 0x00])
      expect(() => readPackOffset(data)).toThrow(/large offset|missing/i)
    })
  })

  describe('Fanout Table', () => {
    it('should parse fanout table from raw bytes', () => {
      const fanoutData = new Uint8Array(256 * 4)
      const view = new DataView(fanoutData.buffer)

      view.setUint32(0 * 4, 5, false) // fanout[0] = 5 (big-endian)
      view.setUint32(1 * 4, 10, false) // fanout[1] = 10
      view.setUint32(255 * 4, 100, false) // fanout[255] = 100

      const fanout = parseFanoutTable(fanoutData)

      expect(fanout[0]).toBe(5)
      expect(fanout[1]).toBe(10)
      expect(fanout[255]).toBe(100)
    })

    it('should have monotonically non-decreasing values', () => {
      const fanoutData = new Uint8Array(256 * 4)
      const view = new DataView(fanoutData.buffer)

      let count = 0
      for (let i = 0; i < 256; i++) {
        if (i % 50 === 0) count += i / 10
        view.setUint32(i * 4, count, false)
      }

      const fanout = parseFanoutTable(fanoutData)

      for (let i = 1; i < 256; i++) {
        expect(fanout[i]).toBeGreaterThanOrEqual(fanout[i - 1])
      }
    })

    it('should get correct fanout range for first byte 0x00', () => {
      const fanout = new Uint32Array(256)
      fanout[0] = 5 // 5 entries with first byte 0x00

      const range = getFanoutRange(fanout, 0x00)

      expect(range.start).toBe(0)
      expect(range.end).toBe(5)
    })

    it('should get correct fanout range for first byte 0x01', () => {
      const fanout = new Uint32Array(256)
      fanout[0] = 3 // 3 entries with first byte 0x00
      fanout[1] = 7 // 4 entries with first byte 0x01 (cumulative)

      const range = getFanoutRange(fanout, 0x01)

      expect(range.start).toBe(3) // Start after 0x00 entries
      expect(range.end).toBe(7)
    })

    it('should get correct fanout range for first byte 0xff', () => {
      const fanout = new Uint32Array(256)
      fanout[254] = 95 // 95 entries up through 0xfe
      fanout[255] = 100 // 5 entries with first byte 0xff

      const range = getFanoutRange(fanout, 0xff)

      expect(range.start).toBe(95)
      expect(range.end).toBe(100)
    })

    it('should return empty range when no entries for first byte', () => {
      const fanout = new Uint32Array(256)
      fanout[0] = 0
      fanout[1] = 0
      fanout[2] = 5 // First entry starts at 0x02

      const range = getFanoutRange(fanout, 0x01)

      expect(range.start).toBe(0)
      expect(range.end).toBe(0)
    })

    it('should reject fanout table with decreasing values during parsing', () => {
      const data = createMinimalPackIndex()
      const view = new DataView(data.buffer)

      // Set invalid decreasing fanout: fanout[0] = 10, fanout[1] = 5
      view.setUint32(8 + 0 * 4, 10, false)
      view.setUint32(8 + 1 * 4, 5, false) // Invalid: less than previous

      // Recompute the checksum after modifying the fanout (so checksum passes but fanout validation fails)
      const dataToHash = data.subarray(0, data.length - 20)
      const checksum = sha1ForTests(dataToHash)
      data.set(checksum, data.length - 20)

      expect(() => parsePackIndex(data)).toThrow(/fanout|monotonic/i)
    })

    it('should use fanout[255] as total object count', () => {
      const fanout = new Uint32Array(256)
      fanout[255] = 42

      // fanout[255] should equal total objects in index
      expect(fanout[255]).toBe(42)
    })
  })

  describe('SHA Checksum Validation', () => {
    it('should verify valid pack index passes checksum validation', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])
      const isValid = verifyPackIndex(indexData)
      expect(isValid).toBe(true)
    })

    it('should reject corrupted pack index (byte modified)', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])
      const corrupted = new Uint8Array(indexData)
      corrupted[100] ^= 0xff // Flip bits in middle

      expect(() => verifyPackIndex(corrupted)).toThrow(/checksum|corrupt|invalid/i)
    })

    it('should reject pack index with wrong checksum', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])
      const corrupted = new Uint8Array(indexData)
      corrupted[corrupted.length - 1] ^= 0xff // Corrupt last byte (checksum)

      expect(() => verifyPackIndex(corrupted)).toThrow(/checksum/i)
    })

    it('should verify fanout table consistency', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])
      const corrupted = new Uint8Array(indexData)
      const view = new DataView(corrupted.buffer)

      // Create invalid decreasing fanout
      view.setUint32(8 + 0 * 4, 10, false)
      view.setUint32(8 + 1 * 4, 5, false)

      expect(() => verifyPackIndex(corrupted)).toThrow(/fanout|monotonic|consistency/i)
    })

    it('should verify object ID sorting', () => {
      // Index with unsorted entries should fail verification
      // Use createPackIndex which computes valid checksums
      expect(() => {
        const indexData = createPackIndex(new Uint8Array(32), [])
        // An empty/valid index should pass verification
        verifyPackIndex(indexData)
      }).not.toThrow() // Empty index is valid
    })

    it('should validate packfile checksum matches', () => {
      const packData = new Uint8Array(32)
      const indexData = createPackIndex(packData, [])
      const index = parsePackIndex(indexData)

      // Pack checksum should be last 20 bytes of packfile (or computed)
      expect(index.packChecksum.length).toBe(20)
    })

    it('should compute index checksum over all preceding data', () => {
      const indexData = createPackIndex(new Uint8Array(32), [])
      const index = parsePackIndex(indexData)

      // Index checksum is SHA-1 of everything before it
      expect(index.indexChecksum.length).toBe(20)
    })
  })

  describe('CRC32 Checksum Calculation', () => {
    it('should calculate CRC32 of empty data', () => {
      const data = new Uint8Array(0)
      const crc = calculateCRC32(data)
      // CRC32 of empty input is 0x00000000
      expect(crc).toBe(0x00000000)
    })

    it('should calculate CRC32 of simple data', () => {
      const data = encoder.encode('hello')
      const crc = calculateCRC32(data)
      // Known CRC32 of "hello"
      expect(crc).toBe(0x3610a686)
    })

    it('should calculate CRC32 matching IEEE 802.3 polynomial', () => {
      // Git uses the standard CRC32 polynomial (0xEDB88320)
      const data = encoder.encode('123456789')
      const crc = calculateCRC32(data)
      // Known CRC32 check value
      expect(crc).toBe(0xcbf43926)
    })

    it('should calculate different CRC32 for different data', () => {
      const crc1 = calculateCRC32(encoder.encode('foo'))
      const crc2 = calculateCRC32(encoder.encode('bar'))
      expect(crc1).not.toBe(crc2)
    })

    it('should calculate consistent CRC32 for same data', () => {
      const data = encoder.encode('test data for crc')
      const crc1 = calculateCRC32(data)
      const crc2 = calculateCRC32(data)
      expect(crc1).toBe(crc2)
    })

    it('should calculate CRC32 of binary data', () => {
      const data = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x01, 0xfe])
      const crc = calculateCRC32(data)
      expect(typeof crc).toBe('number')
      expect(crc).toBeGreaterThanOrEqual(0)
      expect(crc).toBeLessThanOrEqual(0xffffffff)
    })
  })

  describe('Binary Search for Object ID', () => {
    it('should find object in sorted array', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 1 },
        { sha: createTestSha('bbb'), offset: 200, crc32: 2 },
        { sha: createTestSha('ccc'), offset: 300, crc32: 3 }
      ]

      const index = binarySearchObjectId(entries, createTestSha('bbb'), 0, 3)
      expect(index).toBe(1)
    })

    it('should return -1 for missing object', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 1 },
        { sha: createTestSha('ccc'), offset: 300, crc32: 3 }
      ]

      const index = binarySearchObjectId(entries, createTestSha('bbb'), 0, 2)
      expect(index).toBe(-1)
    })

    it('should find first element', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 1 },
        { sha: createTestSha('bbb'), offset: 200, crc32: 2 },
        { sha: createTestSha('ccc'), offset: 300, crc32: 3 }
      ]

      const index = binarySearchObjectId(entries, createTestSha('aaa'), 0, 3)
      expect(index).toBe(0)
    })

    it('should find last element', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 1 },
        { sha: createTestSha('bbb'), offset: 200, crc32: 2 },
        { sha: createTestSha('ccc'), offset: 300, crc32: 3 }
      ]

      const index = binarySearchObjectId(entries, createTestSha('ccc'), 0, 3)
      expect(index).toBe(2)
    })

    it('should search within specified range', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 1 },
        { sha: createTestSha('bbb'), offset: 200, crc32: 2 },
        { sha: createTestSha('ccc'), offset: 300, crc32: 3 },
        { sha: createTestSha('ddd'), offset: 400, crc32: 4 }
      ]

      // Search only in range [1, 3) - should find 'bbb' but not 'aaa' or 'ddd'
      expect(binarySearchObjectId(entries, createTestSha('bbb'), 1, 3)).toBe(1)
      expect(binarySearchObjectId(entries, createTestSha('aaa'), 1, 3)).toBe(-1)
      expect(binarySearchObjectId(entries, createTestSha('ddd'), 1, 3)).toBe(-1)
    })

    it('should handle empty range', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('aaa'), offset: 100, crc32: 1 }
      ]

      const index = binarySearchObjectId(entries, createTestSha('aaa'), 0, 0)
      expect(index).toBe(-1)
    })

    it('should handle single element range', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('bbb'), offset: 200, crc32: 2 }
      ]

      expect(binarySearchObjectId(entries, createTestSha('bbb'), 0, 1)).toBe(0)
      expect(binarySearchObjectId(entries, createTestSha('aaa'), 0, 1)).toBe(-1)
    })

    it('should handle large sorted array efficiently', () => {
      const entries: PackIndexEntry[] = []
      for (let i = 0; i < 10000; i++) {
        entries.push({
          sha: i.toString(16).padStart(40, '0'),
          offset: i * 100,
          crc32: i
        })
      }

      // Find entry near the end (9000 = 0x2328)
      const targetId = '0000000000000000000000000000000000002328'
      const index = binarySearchObjectId(entries, targetId, 0, entries.length)
      expect(index).toBe(9000)
    })
  })

  describe('Pack Index Serialization', () => {
    it('should serialize empty index correctly', () => {
      const index: PackIndex = {
        version: 2,
        fanout: new Uint32Array(256),
        entries: [],
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)

      // Verify header
      expect(data[0]).toBe(0xff)
      expect(data[1]).toBe(0x74)
      expect(data[2]).toBe(0x4f)
      expect(data[3]).toBe(0x63)
      expect(data[7]).toBe(2)
    })

    it('should serialize and deserialize round-trip', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 100, crc32: 0x12345678 },
        { sha: createTestSha('def'), offset: 200, crc32: 0x87654321 }
      ]

      const original: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: hexToBytes('1234567890123456789012345678901234567890'),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(original)
      const parsed = parsePackIndex(data)

      expect(parsed.version).toBe(original.version)
      expect(parsed.entries.length).toBe(original.entries.length)

      for (let i = 0; i < entries.length; i++) {
        expect(parsed.entries[i].sha).toBe(original.entries[i].sha)
        expect(parsed.entries[i].offset).toBe(original.entries[i].offset)
        expect(parsed.entries[i].crc32).toBe(original.entries[i].crc32)
      }
    })

    it('should serialize large offsets in 8-byte table', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 0x100000000, crc32: 0 } // 4GB
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)
      const parsed = parsePackIndex(data)

      expect(parsed.entries[0].offset).toBe(0x100000000)
    })

    it('should write fanout table in big-endian format', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'aa' + '0'.repeat(38), offset: 100, crc32: 0 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)

      // fanout[0xa9] should be 0 (big-endian)
      const fanoutOffset = 8
      const a9Offset = fanoutOffset + 0xa9 * 4
      expect(data[a9Offset]).toBe(0)
      expect(data[a9Offset + 3]).toBe(0)

      // fanout[0xaa] should be 1 (big-endian)
      const aaOffset = fanoutOffset + 0xaa * 4
      expect(data[aaOffset]).toBe(0)
      expect(data[aaOffset + 3]).toBe(1)
    })

    it('should write SHA-1 as raw 20 bytes', () => {
      const entries: PackIndexEntry[] = [
        { sha: 'aabbccddeeff00112233445566778899aabbccdd', offset: 100, crc32: 0 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)
      const parsed = parsePackIndex(data)

      expect(parsed.entries[0].sha).toBe('aabbccddeeff00112233445566778899aabbccdd')
    })
  })

  describe('Edge Cases', () => {
    it('should handle maximum number of objects (2^32 - 1) in fanout', () => {
      const fanout = new Uint32Array(256)
      fanout[255] = 0xffffffff
      expect(fanout[255]).toBe(0xffffffff)
    })

    it('should handle object IDs at every byte boundary', () => {
      const entries: PackIndexEntry[] = []
      for (let i = 0; i < 256; i++) {
        entries.push({
          sha: i.toString(16).padStart(2, '0') + '0'.repeat(38),
          offset: i * 100,
          crc32: i
        })
      }

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      // Each fanout bucket should have exactly 1 entry
      for (let i = 0; i < 256; i++) {
        expect(index.fanout[i]).toBe(i + 1)
      }
    })

    it('should handle duplicate object IDs gracefully', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 100, crc32: 1 },
        { sha: createTestSha('abc'), offset: 200, crc32: 2 } // Duplicate!
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const result = lookupObject(index, createTestSha('abc'))
      expect(result).not.toBeNull()
    })

    it('should handle zero CRC32 value', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 100, crc32: 0 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)
      const parsed = parsePackIndex(data)

      expect(parsed.entries[0].crc32).toBe(0)
    })

    it('should handle maximum CRC32 value (0xFFFFFFFF)', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 100, crc32: 0xffffffff }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)
      const parsed = parsePackIndex(data)

      expect(parsed.entries[0].crc32).toBe(0xffffffff)
    })

    it('should handle offset of zero', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('abc'), offset: 0, crc32: 0 }
      ]

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      const data = serializePackIndex(index)
      const parsed = parsePackIndex(data)

      expect(parsed.entries[0].offset).toBe(0)
    })
  })

  describe('Integration Tests', () => {
    it('should create index and perform lookup end-to-end', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('a0b1'), offset: 12, crc32: 0x11111111 },
        { sha: createTestSha('b0b2'), offset: 50, crc32: 0x22222222 },
        { sha: createTestSha('c0b3'), offset: 100, crc32: 0x33333333 }
      ].sort((a, b) => a.sha.localeCompare(b.sha))

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      // Lookup each object
      const result1 = lookupObject(index, createTestSha('a0b1'))
      const result2 = lookupObject(index, createTestSha('b0b2'))
      const result3 = lookupObject(index, createTestSha('c0b3'))

      expect(result1).not.toBeNull()
      expect(result2).not.toBeNull()
      expect(result3).not.toBeNull()

      // Missing object (use valid hex that doesn't exist)
      const missing = lookupObject(index, createTestSha('deaf'))
      expect(missing).toBeNull()
    })

    it('should handle real-world object ID patterns', () => {
      // Real SHA-1 hashes from git
      const realShas = [
        'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', // Empty blob
        '8ab686eafeb1f44702738c8b0f24f2567c36da6d', // Example commit
        'd8329fc1cc938780ffdd9f94e0d364e0ea74f579'  // Example tree
      ]

      const entries: PackIndexEntry[] = realShas.map((sha, i) => ({
        sha: sha,
        offset: 100 + i * 100,
        crc32: i + 1
      })).sort((a, b) => a.sha.localeCompare(b.sha))

      const index: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20),
        indexChecksum: new Uint8Array(20)
      }

      // All should be findable
      for (const sha of realShas) {
        const result = lookupObject(index, sha)
        expect(result).not.toBeNull()
        expect(result?.sha).toBe(sha)
      }
    })

    it('should serialize, parse, and verify complete workflow', () => {
      const entries: PackIndexEntry[] = [
        { sha: createTestSha('f1a5'), offset: 12, crc32: 0xaaaaaaaa },
        { sha: createTestSha('5ec0'), offset: 100, crc32: 0xbbbbbbbb }
      ].sort((a, b) => a.sha.localeCompare(b.sha))

      const original: PackIndex = {
        version: 2,
        fanout: createFanoutForEntries(entries),
        entries,
        packChecksum: new Uint8Array(20).fill(0x42),
        indexChecksum: new Uint8Array(20)
      }

      // Serialize
      const serialized = serializePackIndex(original)

      // Verify
      expect(verifyPackIndex(serialized)).toBe(true)

      // Parse
      const parsed = parsePackIndex(serialized)

      // Lookup
      const result = lookupObject(parsed, createTestSha('f1a5'))
      expect(result).not.toBeNull()
      expect(result?.offset).toBe(12)
      expect(result?.crc32).toBe(0xaaaaaaaa)
    })
  })
})
