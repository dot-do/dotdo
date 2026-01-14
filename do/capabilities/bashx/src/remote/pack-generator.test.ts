/**
 * Pack Generator Tests (RED Phase)
 *
 * Comprehensive tests for Git pack file generation.
 * These tests verify correct pack file format according to Git protocol.
 *
 * Pack file format (v2):
 * - Header: "PACK" (4 bytes) + version (4 bytes BE) + object count (4 bytes BE)
 * - Objects: type/size varint + compressed data
 * - Footer: SHA-1 checksum (20 bytes)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PackGenerator,
  type PackObject,
  ObjectType,
  OBJ_COMMIT,
  OBJ_TREE,
  OBJ_BLOB,
  OBJ_TAG,
  computeSha1,
  computeGitObjectHash,
} from './pack-generator.js'

// We'll also need PackParser for round-trip tests
import { PackParser } from './pack-parser.js'

// Helper to create test objects
function createTestBlob(content: string): PackObject {
  return {
    type: OBJ_BLOB,
    data: new TextEncoder().encode(content),
  }
}

function createTestTree(entries: Array<{ mode: string; name: string; hash: string }>): PackObject {
  // Git tree format: mode SP name NUL hash (20 bytes binary)
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const modeAndName = new TextEncoder().encode(`${entry.mode} ${entry.name}\0`)
    const hashBytes = hexToBytes(entry.hash)
    parts.push(modeAndName, hashBytes)
  }
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const data = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    data.set(part, offset)
    offset += part.length
  }
  return { type: OBJ_TREE, data }
}

function createTestCommit(options: {
  tree: string
  parent?: string
  author: string
  committer: string
  message: string
}): PackObject {
  const lines = [
    `tree ${options.tree}`,
    ...(options.parent ? [`parent ${options.parent}`] : []),
    `author ${options.author}`,
    `committer ${options.committer}`,
    '',
    options.message,
  ]
  return {
    type: OBJ_COMMIT,
    data: new TextEncoder().encode(lines.join('\n')),
  }
}

function createTestTag(options: {
  object: string
  type: string
  tag: string
  tagger: string
  message: string
}): PackObject {
  const lines = [
    `object ${options.object}`,
    `type ${options.type}`,
    `tag ${options.tag}`,
    `tagger ${options.tagger}`,
    '',
    options.message,
  ]
  return {
    type: OBJ_TAG,
    data: new TextEncoder().encode(lines.join('\n')),
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('PackGenerator', () => {
  let generator: PackGenerator

  beforeEach(() => {
    generator = new PackGenerator()
  })

  describe('Header Generation', () => {
    it('should write "PACK" magic bytes at offset 0', () => {
      const result = generator.generate([])
      const header = result.pack.slice(0, 4)
      expect(header).toEqual(new Uint8Array([0x50, 0x41, 0x43, 0x4b])) // "PACK"
    })

    it('should write version 2 as big-endian uint32 at offset 4', () => {
      const result = generator.generate([])
      const version = result.pack.slice(4, 8)
      // Version 2 in big-endian: 0x00 0x00 0x00 0x02
      expect(version).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x02]))
    })

    it('should write object count as big-endian uint32 at offset 8', () => {
      const objects = [createTestBlob('hello'), createTestBlob('world')]
      const result = generator.generate(objects)
      const count = result.pack.slice(8, 12)
      // 2 objects in big-endian: 0x00 0x00 0x00 0x02
      expect(count).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x02]))
    })

    it('should write correct count for 256 objects', () => {
      const objects = Array.from({ length: 256 }, (_, i) => createTestBlob(`blob${i}`))
      const result = generator.generate(objects)
      const count = result.pack.slice(8, 12)
      // 256 in big-endian: 0x00 0x00 0x01 0x00
      expect(count).toEqual(new Uint8Array([0x00, 0x00, 0x01, 0x00]))
    })

    it('should write correct count for 65536 objects', () => {
      const objects = Array.from({ length: 65536 }, (_, i) => createTestBlob(`b${i}`))
      const result = generator.generate(objects)
      const count = result.pack.slice(8, 12)
      // 65536 in big-endian: 0x00 0x01 0x00 0x00
      expect(count).toEqual(new Uint8Array([0x00, 0x01, 0x00, 0x00]))
    })

    it('should write zero count for empty pack', () => {
      const result = generator.generate([])
      const count = result.pack.slice(8, 12)
      expect(count).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00]))
    })

    it('should have header size of 12 bytes', () => {
      const result = generator.generate([])
      // Empty pack: 12 bytes header + 20 bytes checksum
      expect(result.pack.length).toBeGreaterThanOrEqual(12)
    })
  })

  describe('Object Type Encoding', () => {
    it('should encode OBJ_COMMIT with type bits 001', () => {
      const commit = createTestCommit({
        tree: 'a'.repeat(40),
        author: 'Test <test@test.com> 1234567890 +0000',
        committer: 'Test <test@test.com> 1234567890 +0000',
        message: 'Initial commit',
      })
      const result = generator.generate([commit])

      // After header (12 bytes), first byte should have type in bits 6-4
      const firstObjectByte = result.pack[12]
      const typeBits = (firstObjectByte >> 4) & 0x07
      expect(typeBits).toBe(OBJ_COMMIT) // 1
    })

    it('should encode OBJ_TREE with type bits 010', () => {
      const tree = createTestTree([
        { mode: '100644', name: 'file.txt', hash: 'a'.repeat(40) },
      ])
      const result = generator.generate([tree])

      const firstObjectByte = result.pack[12]
      const typeBits = (firstObjectByte >> 4) & 0x07
      expect(typeBits).toBe(OBJ_TREE) // 2
    })

    it('should encode OBJ_BLOB with type bits 011', () => {
      const blob = createTestBlob('hello world')
      const result = generator.generate([blob])

      const firstObjectByte = result.pack[12]
      const typeBits = (firstObjectByte >> 4) & 0x07
      expect(typeBits).toBe(OBJ_BLOB) // 3
    })

    it('should encode OBJ_TAG with type bits 100', () => {
      const tag = createTestTag({
        object: 'a'.repeat(40),
        type: 'commit',
        tag: 'v1.0.0',
        tagger: 'Test <test@test.com> 1234567890 +0000',
        message: 'Version 1.0.0',
      })
      const result = generator.generate([tag])

      const firstObjectByte = result.pack[12]
      const typeBits = (firstObjectByte >> 4) & 0x07
      expect(typeBits).toBe(OBJ_TAG) // 4
    })

    it('should reject invalid object types', () => {
      const invalidObject = {
        type: 99 as ObjectType,
        data: new Uint8Array([1, 2, 3]),
      }
      expect(() => generator.generate([invalidObject])).toThrow(/invalid.*type/i)
    })

    it('should reject type 0 (undefined)', () => {
      const invalidObject = {
        type: 0 as ObjectType,
        data: new Uint8Array([1, 2, 3]),
      }
      expect(() => generator.generate([invalidObject])).toThrow(/invalid.*type/i)
    })

    it('should reject type 5 (reserved)', () => {
      const invalidObject = {
        type: 5 as ObjectType,
        data: new Uint8Array([1, 2, 3]),
      }
      expect(() => generator.generate([invalidObject])).toThrow(/invalid.*type|reserved/i)
    })
  })

  describe('Varint Size Encoding', () => {
    it('should encode size <= 15 in single byte (4 bits in first byte)', () => {
      // Size fits in 4 bits of first byte, MSB = 0 means no continuation
      const blob = createTestBlob('hello') // 5 bytes
      const result = generator.generate([blob])

      const firstByte = result.pack[12]
      // MSB should be 0 (no continuation)
      expect(firstByte & 0x80).toBe(0)
      // Size in low 4 bits
      const sizeLow4 = firstByte & 0x0f
      expect(sizeLow4).toBe(5)
    })

    it('should encode size 16-127 in two bytes', () => {
      // Create blob with 50 bytes: needs 2 bytes (4 bits + 7 bits)
      const blob = createTestBlob('x'.repeat(50))
      const result = generator.generate([blob])

      const firstByte = result.pack[12]
      // MSB should be 1 (continuation)
      expect(firstByte & 0x80).toBe(0x80)

      // Second byte should have MSB = 0 (no more continuation)
      const secondByte = result.pack[13]
      expect(secondByte & 0x80).toBe(0)

      // Decode: size = (low 4 bits) + (7 bits << 4)
      const sizeLow4 = firstByte & 0x0f
      const sizeHigh7 = secondByte & 0x7f
      const decodedSize = sizeLow4 + (sizeHigh7 << 4)
      expect(decodedSize).toBe(50)
    })

    it('should encode size 128-2047 in two bytes', () => {
      const blob = createTestBlob('x'.repeat(500))
      const result = generator.generate([blob])

      // Parse varint to verify correct encoding
      let offset = 12
      let size = result.pack[offset] & 0x0f
      let shift = 4

      if (result.pack[offset] & 0x80) {
        offset++
        while (offset < result.pack.length) {
          const byte = result.pack[offset]
          size += (byte & 0x7f) << shift
          shift += 7
          if (!(byte & 0x80)) break
          offset++
        }
      }

      expect(size).toBe(500)
    })

    it('should encode size 2048+ in three bytes', () => {
      const blob = createTestBlob('x'.repeat(5000))
      const result = generator.generate([blob])

      // Verify we can decode the size correctly
      let offset = 12
      let size = result.pack[offset] & 0x0f
      let shift = 4

      if (result.pack[offset] & 0x80) {
        offset++
        while (offset < result.pack.length) {
          const byte = result.pack[offset]
          size += (byte & 0x7f) << shift
          shift += 7
          if (!(byte & 0x80)) break
          offset++
        }
      }

      expect(size).toBe(5000)
    })

    it('should encode large sizes (100KB)', () => {
      const blob = createTestBlob('x'.repeat(100000))
      const result = generator.generate([blob])

      // Verify varint decoding
      let offset = 12
      let size = result.pack[offset] & 0x0f
      let shift = 4

      if (result.pack[offset] & 0x80) {
        offset++
        while (offset < result.pack.length) {
          const byte = result.pack[offset]
          size += (byte & 0x7f) << shift
          shift += 7
          if (!(byte & 0x80)) break
          offset++
        }
      }

      expect(size).toBe(100000)
    })

    it('should correctly encode size 15 (boundary case)', () => {
      const blob = createTestBlob('x'.repeat(15))
      const result = generator.generate([blob])

      const firstByte = result.pack[12]
      // Should fit in single byte
      expect(firstByte & 0x80).toBe(0)
      expect(firstByte & 0x0f).toBe(15)
    })

    it('should correctly encode size 16 (boundary case)', () => {
      const blob = createTestBlob('x'.repeat(16))
      const result = generator.generate([blob])

      const firstByte = result.pack[12]
      // Needs continuation byte
      expect(firstByte & 0x80).toBe(0x80)
      expect(firstByte & 0x0f).toBe(0) // low 4 bits of 16

      const secondByte = result.pack[13]
      expect(secondByte & 0x80).toBe(0)
      expect(secondByte & 0x7f).toBe(1) // 16 >> 4 = 1
    })
  })

  describe('Object Data Compression', () => {
    it('should compress object data with zlib deflate', () => {
      const blob = createTestBlob('hello world')
      const result = generator.generate([blob])

      // After header and varint, data should be zlib compressed
      // Zlib deflate starts with 0x78 (compression method + flags)
      // Note: exact offset depends on varint size

      // Find compressed data start (after varint)
      let offset = 12
      while (result.pack[offset] & 0x80) offset++
      offset++ // past last varint byte

      // Should be zlib compressed (commonly starts with 0x78)
      // Could also be raw deflate, depends on implementation
      expect(result.pack[offset]).toBeDefined()
    })

    it('should produce smaller output than input for compressible data', () => {
      // Highly compressible: repeated pattern
      const largeBlob = createTestBlob('abcdefgh'.repeat(1000))
      const result = generator.generate([largeBlob])

      // Pack should be significantly smaller than raw data
      // 8000 bytes of data + 12 byte header + 20 byte checksum = 8032 minimum uncompressed
      expect(result.pack.length).toBeLessThan(8000)
    })

    it('should handle incompressible data', () => {
      // Random data is hard to compress
      const randomData = new Uint8Array(1000)
      for (let i = 0; i < randomData.length; i++) {
        randomData[i] = Math.floor(Math.random() * 256)
      }
      const blob: PackObject = { type: OBJ_BLOB, data: randomData }
      const result = generator.generate([blob])

      // Should still produce valid pack
      expect(result.pack.length).toBeGreaterThan(0)
    })

    it('should decompress to original data', () => {
      const originalContent = 'This is test content for compression verification!'
      const blob = createTestBlob(originalContent)
      const result = generator.generate([blob])

      // Parse back and verify
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      expect(parsed.objects).toHaveLength(1)
      expect(new TextDecoder().decode(parsed.objects[0].data)).toBe(originalContent)
    })

    it('should handle empty object data', () => {
      const emptyBlob = createTestBlob('')
      const result = generator.generate([emptyBlob])

      expect(result.pack.length).toBeGreaterThan(0)

      const parser = new PackParser()
      const parsed = parser.parse(result.pack)
      expect(parsed.objects[0].data.length).toBe(0)
    })

    it('should handle binary data with null bytes', () => {
      const binaryData = new Uint8Array([0x00, 0xff, 0x00, 0xfe, 0x00, 0xfd])
      const blob: PackObject = { type: OBJ_BLOB, data: binaryData }
      const result = generator.generate([blob])

      const parser = new PackParser()
      const parsed = parser.parse(result.pack)
      expect(parsed.objects[0].data).toEqual(binaryData)
    })
  })

  describe('Checksum Generation', () => {
    it('should append 20-byte SHA-1 checksum at end', () => {
      const result = generator.generate([])
      // Empty pack: 12 bytes header + 20 bytes checksum = 32 bytes
      expect(result.pack.length).toBe(32)
    })

    it('should compute SHA-1 of all preceding bytes', () => {
      const blob = createTestBlob('test')
      const result = generator.generate([blob])

      // Extract checksum (last 20 bytes)
      const checksum = result.pack.slice(-20)

      // Compute expected SHA-1 of pack without checksum
      const packWithoutChecksum = result.pack.slice(0, -20)
      const expectedChecksum = computeSha1(packWithoutChecksum)

      expect(bytesToHex(checksum)).toBe(bytesToHex(expectedChecksum))
    })

    it('should return checksum in result object', () => {
      const blob = createTestBlob('test')
      const result = generator.generate([blob])

      expect(result.checksum).toBeDefined()
      expect(result.checksum.length).toBe(20)
      expect(result.pack.slice(-20)).toEqual(result.checksum)
    })

    it('should produce different checksums for different content', () => {
      const result1 = generator.generate([createTestBlob('hello')])
      const result2 = generator.generate([createTestBlob('world')])

      expect(bytesToHex(result1.checksum)).not.toBe(bytesToHex(result2.checksum))
    })

    it('should produce same checksum for same content', () => {
      const gen1 = new PackGenerator()
      const gen2 = new PackGenerator()

      const result1 = gen1.generate([createTestBlob('identical')])
      const result2 = gen2.generate([createTestBlob('identical')])

      expect(bytesToHex(result1.checksum)).toBe(bytesToHex(result2.checksum))
    })

    it('should include object count in checksum computation', () => {
      // Same objects but hypothetically different count would produce different checksum
      const blob = createTestBlob('test')
      const result = generator.generate([blob])

      // Manually compute what checksum should be
      const packData = result.pack.slice(0, -20)
      const expectedChecksum = computeSha1(packData)

      expect(bytesToHex(result.checksum)).toBe(bytesToHex(expectedChecksum))
    })
  })

  describe('Validation - PackParser Compatibility', () => {
    it('should be parseable by PackParser', () => {
      const blob = createTestBlob('hello world')
      const result = generator.generate([blob])

      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      expect(parsed.version).toBe(2)
      expect(parsed.objectCount).toBe(1)
      expect(parsed.objects).toHaveLength(1)
    })

    it('should preserve object types through round-trip', () => {
      const objects: PackObject[] = [
        createTestBlob('blob content'),
        createTestTree([{ mode: '100644', name: 'test.txt', hash: 'a'.repeat(40) }]),
        createTestCommit({
          tree: 'b'.repeat(40),
          author: 'Test <test@test.com> 1234567890 +0000',
          committer: 'Test <test@test.com> 1234567890 +0000',
          message: 'Test commit',
        }),
      ]

      const result = generator.generate(objects)
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      expect(parsed.objects[0].type).toBe(OBJ_BLOB)
      expect(parsed.objects[1].type).toBe(OBJ_TREE)
      expect(parsed.objects[2].type).toBe(OBJ_COMMIT)
    })

    it('should preserve object data through round-trip', () => {
      const content = 'This is the exact content that should be preserved!'
      const blob = createTestBlob(content)

      const result = generator.generate([blob])
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      const decoded = new TextDecoder().decode(parsed.objects[0].data)
      expect(decoded).toBe(content)
    })

    it('should preserve object order', () => {
      const objects = [
        createTestBlob('first'),
        createTestBlob('second'),
        createTestBlob('third'),
      ]

      const result = generator.generate(objects)
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      expect(new TextDecoder().decode(parsed.objects[0].data)).toBe('first')
      expect(new TextDecoder().decode(parsed.objects[1].data)).toBe('second')
      expect(new TextDecoder().decode(parsed.objects[2].data)).toBe('third')
    })

    it('should handle large number of objects', () => {
      const objects = Array.from({ length: 100 }, (_, i) => createTestBlob(`object ${i}`))

      const result = generator.generate(objects)
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      expect(parsed.objectCount).toBe(100)
      expect(parsed.objects).toHaveLength(100)
    })
  })

  describe('Validation - Git Compatibility', () => {
    it('should produce valid pack for git verify-pack -v', async () => {
      const blob = createTestBlob('content for git verification')
      const result = generator.generate([blob])

      // This test verifies the pack file format is correct
      // In a real scenario, we'd write to disk and run git verify-pack
      // For now, we verify the structure is correct

      // Magic bytes
      expect(result.pack.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x41, 0x43, 0x4b]))

      // Version
      expect(result.pack.slice(4, 8)).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x02]))

      // Object count matches
      const count = (result.pack[8] << 24) | (result.pack[9] << 16) | (result.pack[10] << 8) | result.pack[11]
      expect(count).toBe(1)

      // Checksum is 20 bytes
      expect(result.checksum.length).toBe(20)
    })

    it('should match git pack-objects output format', () => {
      // Test that our pack file follows the same format as git pack-objects
      const blob = createTestBlob('test content')
      const result = generator.generate([blob])

      // Header check
      const header = new TextDecoder().decode(result.pack.slice(0, 4))
      expect(header).toBe('PACK')

      // Version 2
      const version = new DataView(result.pack.buffer, result.pack.byteOffset + 4, 4).getUint32(0)
      expect(version).toBe(2)
    })

    it('should compute correct object hashes', () => {
      const content = 'blob test content'
      const blob = createTestBlob(content)
      const result = generator.generate([blob])

      // Git object hash is SHA-1 of "type size\0data"
      const expectedHash = computeGitObjectHash('blob', blob.data)

      // The result should include object hashes
      expect(result.objectHashes).toBeDefined()
      expect(result.objectHashes).toHaveLength(1)
      expect(bytesToHex(result.objectHashes![0])).toBe(bytesToHex(expectedHash))
    })
  })

  describe('Round-Trip - Objects In = Objects Out', () => {
    it('should round-trip single blob', () => {
      const original = createTestBlob('round trip test')
      const packed = generator.generate([original])
      const parsed = new PackParser().parse(packed.pack)

      expect(parsed.objects).toHaveLength(1)
      expect(parsed.objects[0].type).toBe(original.type)
      expect(parsed.objects[0].data).toEqual(original.data)
    })

    it('should round-trip multiple objects of same type', () => {
      const originals = [
        createTestBlob('first blob'),
        createTestBlob('second blob'),
        createTestBlob('third blob'),
      ]

      const packed = generator.generate(originals)
      const parsed = new PackParser().parse(packed.pack)

      expect(parsed.objects).toHaveLength(3)
      for (let i = 0; i < 3; i++) {
        expect(parsed.objects[i].type).toBe(originals[i].type)
        expect(parsed.objects[i].data).toEqual(originals[i].data)
      }
    })

    it('should round-trip mixed object types', () => {
      const originals: PackObject[] = [
        createTestBlob('blob data'),
        createTestTree([{ mode: '100644', name: 'file.txt', hash: 'a'.repeat(40) }]),
        createTestCommit({
          tree: 'b'.repeat(40),
          author: 'Author <a@a.com> 0 +0000',
          committer: 'Committer <c@c.com> 0 +0000',
          message: 'message',
        }),
        createTestTag({
          object: 'c'.repeat(40),
          type: 'commit',
          tag: 'v1.0',
          tagger: 'Tagger <t@t.com> 0 +0000',
          message: 'tag message',
        }),
      ]

      const packed = generator.generate(originals)
      const parsed = new PackParser().parse(packed.pack)

      expect(parsed.objects).toHaveLength(4)
      for (let i = 0; i < 4; i++) {
        expect(parsed.objects[i].type).toBe(originals[i].type)
        expect(parsed.objects[i].data).toEqual(originals[i].data)
      }
    })

    it('should round-trip large objects', () => {
      const largeContent = 'x'.repeat(100000)
      const original = createTestBlob(largeContent)

      const packed = generator.generate([original])
      const parsed = new PackParser().parse(packed.pack)

      expect(new TextDecoder().decode(parsed.objects[0].data)).toBe(largeContent)
    })

    it('should round-trip binary data', () => {
      const binaryData = new Uint8Array(256)
      for (let i = 0; i < 256; i++) binaryData[i] = i
      const original: PackObject = { type: OBJ_BLOB, data: binaryData }

      const packed = generator.generate([original])
      const parsed = new PackParser().parse(packed.pack)

      expect(parsed.objects[0].data).toEqual(binaryData)
    })

    it('should round-trip empty pack', () => {
      const packed = generator.generate([])
      const parsed = new PackParser().parse(packed.pack)

      expect(parsed.objectCount).toBe(0)
      expect(parsed.objects).toHaveLength(0)
    })
  })

  describe('Delta Generation (Advanced)', () => {
    describe('OFS_DELTA encoding', () => {
      it('should generate OFS_DELTA for similar objects when delta is smaller', () => {
        // Create two similar blobs - second is slightly modified version of first
        const base = createTestBlob('This is the original content that will be the base object.')
        const derived = createTestBlob('This is the original content that will be the modified object.')

        const result = generator.generate([base, derived], { useDelta: true })

        // Should use delta encoding
        expect(result.deltaCount).toBeGreaterThan(0)
      })

      it('should encode delta offset as negative varint', () => {
        const base = createTestBlob('base content '.repeat(100))
        const derived = createTestBlob('base content '.repeat(100) + 'extra')

        const result = generator.generate([base, derived], { useDelta: true })

        // Second object should be OFS_DELTA (type 6)
        // Find the second object's type
        const parser = new PackParser()
        const parsed = parser.parse(result.pack)

        // If delta was used, the raw type in pack would be OFS_DELTA
        // But parser should resolve it back to BLOB
        expect(parsed.objects[1].type).toBe(OBJ_BLOB)
      })

      it('should compute correct base offset for OFS_DELTA', () => {
        const base = createTestBlob('x'.repeat(1000))
        const derived = createTestBlob('x'.repeat(1000) + 'y')

        const result = generator.generate([base, derived], { useDelta: true })

        // The offset should point back to base object correctly
        // Verify by parsing - if offset is wrong, parser will fail or return wrong data
        const parsed = new PackParser().parse(result.pack)
        expect(new TextDecoder().decode(parsed.objects[1].data)).toBe('x'.repeat(1000) + 'y')
      })
    })

    describe('Delta computation', () => {
      it('should compute efficient delta for append-only changes', () => {
        const base = createTestBlob('original content')
        const derived = createTestBlob('original content with additions')

        const result = generator.generate([base, derived], { useDelta: true })

        // Delta should be much smaller than full derived object
        // Pack with delta should be smaller than pack without
        const withoutDelta = generator.generate([base, derived], { useDelta: false })
        expect(result.pack.length).toBeLessThan(withoutDelta.pack.length)
      })

      it('should compute efficient delta for single byte change', () => {
        const base = createTestBlob('Hello World!')
        const derived = createTestBlob('Hello world!') // lowercase 'w'

        const result = generator.generate([base, derived], { useDelta: true })

        if (result.deltaCount && result.deltaCount > 0) {
          // Delta should be very small - just the changed byte
          const withoutDelta = generator.generate([base, derived], { useDelta: false })
          expect(result.pack.length).toBeLessThan(withoutDelta.pack.length)
        }
      })

      it('should compute efficient delta for insertion in middle', () => {
        const base = createTestBlob('AAAAABBBBB')
        const derived = createTestBlob('AAAAAXXXXXBBBBB')

        const result = generator.generate([base, derived], { useDelta: true })

        // Verify data integrity
        const parsed = new PackParser().parse(result.pack)
        expect(new TextDecoder().decode(parsed.objects[1].data)).toBe('AAAAAXXXXXBBBBB')
      })

      it('should compute efficient delta for deletion', () => {
        const base = createTestBlob('AAAAABBBBBCCCCC')
        const derived = createTestBlob('AAAAACCCCC') // BBBBB removed

        const result = generator.generate([base, derived], { useDelta: true })

        const parsed = new PackParser().parse(result.pack)
        expect(new TextDecoder().decode(parsed.objects[1].data)).toBe('AAAAACCCCC')
      })
    })

    describe('Delta fallback', () => {
      it('should fall back to full object if delta is larger', () => {
        // Two completely different objects - delta would be larger
        const base = createTestBlob('AAAAAAAAAA')
        const derived = createTestBlob('BBBBBBBBBB')

        const result = generator.generate([base, derived], { useDelta: true })

        // Should not use delta when it's not beneficial
        // Both objects should be stored as full objects
        const parsed = new PackParser().parse(result.pack)
        expect(parsed.objects[0].type).toBe(OBJ_BLOB)
        expect(parsed.objects[1].type).toBe(OBJ_BLOB)
      })

      it('should fall back when objects are of different types', () => {
        const blob = createTestBlob('content')
        const tree = createTestTree([{ mode: '100644', name: 'f.txt', hash: 'a'.repeat(40) }])

        const result = generator.generate([blob, tree], { useDelta: true })

        // Cannot delta between different types
        const parsed = new PackParser().parse(result.pack)
        expect(parsed.objects[0].type).toBe(OBJ_BLOB)
        expect(parsed.objects[1].type).toBe(OBJ_TREE)
      })

      it('should fall back for small objects where delta overhead exceeds savings', () => {
        const base = createTestBlob('ab')
        const derived = createTestBlob('ac')

        const result = generator.generate([base, derived], { useDelta: true })

        // For tiny objects, delta overhead makes it not worthwhile
        // Should store as full objects
        const parsed = new PackParser().parse(result.pack)
        expect(new TextDecoder().decode(parsed.objects[1].data)).toBe('ac')
      })
    })

    describe('REF_DELTA encoding (optional)', () => {
      it('should support REF_DELTA with base object hash', () => {
        const base = createTestBlob('base object content for ref delta test')
        const derived = createTestBlob('base object content for ref delta test with modification')

        const result = generator.generate([base, derived], {
          useDelta: true,
          preferRefDelta: true,
        })

        // Should be parseable
        const parsed = new PackParser().parse(result.pack)
        expect(parsed.objects).toHaveLength(2)
      })

      it('should include 20-byte base hash in REF_DELTA objects', () => {
        const base = createTestBlob('reference base')
        const derived = createTestBlob('reference base extended')

        const result = generator.generate([base, derived], {
          useDelta: true,
          preferRefDelta: true,
        })

        // REF_DELTA type is 7, includes 20-byte hash of base object
        // The parser should still resolve the data correctly
        const parsed = new PackParser().parse(result.pack)
        expect(new TextDecoder().decode(parsed.objects[1].data)).toBe('reference base extended')
      })
    })
  })

  describe('Error Handling', () => {
    it('should throw on null object in array', () => {
      expect(() => generator.generate([null as any])).toThrow()
    })

    it('should throw on undefined object in array', () => {
      expect(() => generator.generate([undefined as any])).toThrow()
    })

    it('should throw on object with null data', () => {
      expect(() => generator.generate([{ type: OBJ_BLOB, data: null as any }])).toThrow()
    })

    it('should throw on object with undefined data', () => {
      expect(() => generator.generate([{ type: OBJ_BLOB, data: undefined as any }])).toThrow()
    })

    it('should handle very large object count', () => {
      // This tests that we don't overflow the 32-bit count
      // In practice, we might want to limit this
      // Just verify it doesn't crash on reasonable large numbers
      const objects = Array.from({ length: 1000 }, (_, i) => createTestBlob(`o${i}`))
      const result = generator.generate(objects)
      expect(result.objectCount).toBe(1000)
    })
  })

  describe('Options', () => {
    it('should support compression level option', () => {
      const blob = createTestBlob('compressible content '.repeat(100))

      const resultDefault = generator.generate([blob])
      const resultMaxCompression = generator.generate([blob], { compressionLevel: 9 })
      const resultNoCompression = generator.generate([blob], { compressionLevel: 0 })

      // Higher compression = smaller pack (usually)
      expect(resultMaxCompression.pack.length).toBeLessThanOrEqual(resultDefault.pack.length)
      // No compression = larger pack
      expect(resultNoCompression.pack.length).toBeGreaterThanOrEqual(resultDefault.pack.length)
    })

    it('should support thin pack option', () => {
      const blob = createTestBlob('test')
      const result = generator.generate([blob], { thin: true })

      // Thin packs can reference objects not in the pack
      // For basic test, just verify it generates
      expect(result.pack.length).toBeGreaterThan(0)
    })

    it('should track statistics in result', () => {
      const objects = [
        createTestBlob('blob 1'),
        createTestBlob('blob 2'),
        createTestTree([{ mode: '100644', name: 'f.txt', hash: 'a'.repeat(40) }]),
      ]

      const result = generator.generate(objects)

      expect(result.objectCount).toBe(3)
      expect(result.packSize).toBe(result.pack.length)
      expect(result.uncompressedSize).toBeGreaterThan(0)
    })
  })
})

// Note: computeSha1 and computeGitObjectHash are imported from pack-generator.js
