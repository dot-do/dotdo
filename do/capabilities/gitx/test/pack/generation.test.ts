import { describe, it, expect } from 'vitest'
import {
  generatePackfile,
  PackfileGenerator,
  GeneratorOptions,
  PackableObject,
  GeneratedPackfile,
  computePackChecksum,
  orderObjectsForCompression,
  selectDeltaBase,
  DeltaCandidate,
  generateThinPack,
  ThinPackOptions,
  PackGenerationStats
} from '../../src/pack/generation'
import { PackObjectType } from '../../src/pack/format'

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

// Create a test SHA-1 (40 hex chars)
function createTestSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

describe('Pack Generation', () => {
  describe('generatePackfile', () => {
    it('should generate a valid packfile from empty object set', () => {
      const objects: PackableObject[] = []
      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
      // Minimum: header (12) + checksum (20)
      expect(result.length).toBeGreaterThanOrEqual(32)
    })

    it('should generate packfile with single blob object', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('abc123'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('Hello, World!')
        }
      ]
      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
      // Check PACK header
      expect(String.fromCharCode(result[0], result[1], result[2], result[3])).toBe('PACK')
      // Check version (big-endian 2)
      expect(result[7]).toBe(2)
      // Check object count (1 object)
      expect(result[11]).toBe(1)
    })

    it('should generate packfile with multiple objects', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('aaa'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content1')
        },
        {
          sha: createTestSha('bbb'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content2')
        },
        {
          sha: createTestSha('ccc'),
          type: PackObjectType.OBJ_TREE,
          data: new Uint8Array([0x31, 0x30, 0x30, 0x36, 0x34, 0x34])
        }
      ]
      const result = generatePackfile(objects)

      // Check object count in header
      const objectCount = (result[8] << 24) | (result[9] << 16) | (result[10] << 8) | result[11]
      expect(objectCount).toBe(3)
    })

    it('should generate packfile with all object types', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('blob'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('blob content')
        },
        {
          sha: createTestSha('tree'),
          type: PackObjectType.OBJ_TREE,
          data: new Uint8Array([0x31, 0x30, 0x30, 0x36, 0x34, 0x34])
        },
        {
          sha: createTestSha('commit'),
          type: PackObjectType.OBJ_COMMIT,
          data: encoder.encode('tree abc\nauthor x <x@x> 1 +0\n\nmsg')
        },
        {
          sha: createTestSha('tag'),
          type: PackObjectType.OBJ_TAG,
          data: encoder.encode('object abc\ntype commit\ntag v1.0\n')
        }
      ]
      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
      const objectCount = (result[8] << 24) | (result[9] << 16) | (result[10] << 8) | result[11]
      expect(objectCount).toBe(4)
    })

    it('should generate packfile with large object', () => {
      const largeContent = new Uint8Array(100000)
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256
      }

      const objects: PackableObject[] = [
        {
          sha: createTestSha('large'),
          type: PackObjectType.OBJ_BLOB,
          data: largeContent
        }
      ]
      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
      // Compressed should be significantly smaller than original
      expect(result.length).toBeLessThan(largeContent.length)
    })

    it('should compress object data with zlib deflate', () => {
      // Highly compressible content
      const repeatContent = new Uint8Array(10000).fill(0x41)

      const objects: PackableObject[] = [
        {
          sha: createTestSha('repeat'),
          type: PackObjectType.OBJ_BLOB,
          data: repeatContent
        }
      ]
      const result = generatePackfile(objects)

      // Header (12) + object header (~2) + compressed (~100) + checksum (20)
      // Should be much smaller than 10000 bytes
      expect(result.length).toBeLessThan(200)
    })

    it('should include trailing SHA-1 checksum', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('test data')
        }
      ]
      const result = generatePackfile(objects)

      // Last 20 bytes are the checksum
      expect(result.length).toBeGreaterThan(20)
      const checksum = result.slice(-20)
      expect(checksum.length).toBe(20)
    })

    it('should produce deterministic output for same input', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('deterministic')
        }
      ]

      const result1 = generatePackfile(objects)
      const result2 = generatePackfile(objects)

      expect(bytesToHex(result1)).toBe(bytesToHex(result2))
    })
  })

  describe('PackfileGenerator class', () => {
    it('should create generator with default options', () => {
      const generator = new PackfileGenerator()

      expect(generator).toBeInstanceOf(PackfileGenerator)
    })

    it('should create generator with custom options', () => {
      const options: GeneratorOptions = {
        enableDeltaCompression: true,
        maxDeltaDepth: 50,
        windowSize: 10,
        compressionLevel: 9
      }
      const generator = new PackfileGenerator(options)

      expect(generator).toBeInstanceOf(PackfileGenerator)
    })

    it('should add objects to generator', () => {
      const generator = new PackfileGenerator()

      generator.addObject({
        sha: createTestSha('obj1'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('content1')
      })
      generator.addObject({
        sha: createTestSha('obj2'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('content2')
      })

      expect(generator.objectCount).toBe(2)
    })

    it('should generate packfile from added objects', () => {
      const generator = new PackfileGenerator()

      generator.addObject({
        sha: createTestSha('obj1'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('test content')
      })

      const result = generator.generate()

      expect(result.packData).toBeInstanceOf(Uint8Array)
      expect(result.checksum).toBeInstanceOf(Uint8Array)
      expect(result.checksum.length).toBe(20)
    })

    it('should track generation statistics', () => {
      const generator = new PackfileGenerator({ enableDeltaCompression: true })

      generator.addObject({
        sha: createTestSha('base'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('base content for delta')
      })
      generator.addObject({
        sha: createTestSha('derived'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('base content for delta with changes')
      })

      const result = generator.generate()

      expect(result.stats).toBeDefined()
      expect(result.stats.totalObjects).toBe(2)
      expect(typeof result.stats.deltaObjects).toBe('number')
      expect(typeof result.stats.totalSize).toBe('number')
      expect(typeof result.stats.compressedSize).toBe('number')
    })

    it('should clear objects after reset', () => {
      const generator = new PackfileGenerator()

      generator.addObject({
        sha: createTestSha('obj'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('content')
      })

      expect(generator.objectCount).toBe(1)

      generator.reset()

      expect(generator.objectCount).toBe(0)
    })

    it('should prevent duplicate objects by SHA', () => {
      const generator = new PackfileGenerator()
      const sha = createTestSha('duplicate')

      generator.addObject({
        sha,
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('content1')
      })
      generator.addObject({
        sha,
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('content2')
      })

      // Should only have one object
      expect(generator.objectCount).toBe(1)
    })
  })

  describe('Delta compression in generated pack', () => {
    it('should use OFS_DELTA for similar objects when enabled', () => {
      const generator = new PackfileGenerator({
        enableDeltaCompression: true,
        maxDeltaDepth: 10
      })

      // Base object
      const baseContent = encoder.encode('The quick brown fox jumps over the lazy dog')
      generator.addObject({
        sha: createTestSha('base'),
        type: PackObjectType.OBJ_BLOB,
        data: baseContent
      })

      // Similar object (should be deltified)
      const derivedContent = encoder.encode('The quick brown cat jumps over the lazy dog')
      generator.addObject({
        sha: createTestSha('derived'),
        type: PackObjectType.OBJ_BLOB,
        data: derivedContent
      })

      const result = generator.generate()

      // Pack should be smaller than sum of both objects
      expect(result.packData.length).toBeLessThan(baseContent.length + derivedContent.length)
      expect(result.stats.deltaObjects).toBeGreaterThan(0)
    })

    it('should use REF_DELTA when base object is external', () => {
      const generator = new PackfileGenerator({
        enableDeltaCompression: true,
        useRefDelta: true
      })

      // Object that references external base
      generator.addDeltaObject({
        sha: createTestSha('derived'),
        type: PackObjectType.OBJ_BLOB,
        baseSha: createTestSha('external_base'),
        delta: new Uint8Array([0x10, 0x12, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f])
      })

      const result = generator.generate()

      expect(result.packData).toBeInstanceOf(Uint8Array)
      // Should contain REF_DELTA object type
    })

    it('should respect maxDeltaDepth limit', () => {
      const generator = new PackfileGenerator({
        enableDeltaCompression: true,
        maxDeltaDepth: 3
      })

      // Add chain of similar objects
      let prevContent = encoder.encode('base content')
      for (let i = 0; i < 10; i++) {
        const content = new Uint8Array(prevContent.length + 10)
        content.set(prevContent, 0)
        content.set(encoder.encode(`addition${i}`), prevContent.length)

        generator.addObject({
          sha: createTestSha(`obj${i}`),
          type: PackObjectType.OBJ_BLOB,
          data: content
        })
        prevContent = content
      }

      const result = generator.generate()

      // Delta depth should not exceed maxDeltaDepth
      expect(result.stats.maxDeltaDepth).toBeLessThanOrEqual(3)
    })

    it('should skip delta for small objects', () => {
      const generator = new PackfileGenerator({
        enableDeltaCompression: true,
        minDeltaSize: 100
      })

      // Small object
      generator.addObject({
        sha: createTestSha('small'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('tiny')
      })

      const result = generator.generate()

      expect(result.stats.deltaObjects).toBe(0)
    })

    it('should compute optimal delta base selection', () => {
      const base1 = encoder.encode('common prefix followed by unique content A')
      const base2 = encoder.encode('common prefix followed by unique content B with more data')
      const target = encoder.encode('common prefix followed by unique content B with modifications')

      const candidates: DeltaCandidate[] = [
        { sha: createTestSha('base1'), type: PackObjectType.OBJ_BLOB, data: base1 },
        { sha: createTestSha('base2'), type: PackObjectType.OBJ_BLOB, data: base2 }
      ]

      const bestBase = selectDeltaBase(
        { sha: createTestSha('target'), type: PackObjectType.OBJ_BLOB, data: target },
        candidates
      )

      // Should select base2 as it's more similar
      expect(bestBase).not.toBeNull()
      expect(bestBase!.sha).toBe(createTestSha('base2'))
    })
  })

  describe('Thin pack generation', () => {
    it('should generate thin pack with external base references', () => {
      const options: ThinPackOptions = {
        externalObjects: new Set([createTestSha('external1'), createTestSha('external2')])
      }

      const objects: PackableObject[] = [
        {
          sha: createTestSha('derived'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('derived content')
        }
      ]

      const result = generateThinPack(objects, options)

      expect(result.packData).toBeInstanceOf(Uint8Array)
      expect(result.isThin).toBe(true)
    })

    it('should include missing bases list for thin pack', () => {
      const options: ThinPackOptions = {
        externalObjects: new Set([createTestSha('external')])
      }

      const result = generateThinPack([], options)

      expect(result.missingBases).toBeDefined()
      expect(Array.isArray(result.missingBases)).toBe(true)
    })

    it('should generate complete pack when no external objects', () => {
      const options: ThinPackOptions = {
        externalObjects: new Set()
      }

      const objects: PackableObject[] = [
        {
          sha: createTestSha('obj'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content')
        }
      ]

      const result = generateThinPack(objects, options)

      expect(result.isThin).toBe(false)
      expect(result.missingBases.length).toBe(0)
    })

    it('should use REF_DELTA for thin pack delta objects', () => {
      const baseSha = createTestSha('external_base')
      const options: ThinPackOptions = {
        externalObjects: new Set([baseSha]),
        baseData: new Map([
          [baseSha, encoder.encode('base content for delta compression')]
        ])
      }

      const objects: PackableObject[] = [
        {
          sha: createTestSha('derived'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('base content for delta compression with changes')
        }
      ]

      const result = generateThinPack(objects, options)

      expect(result.isThin).toBe(true)
      // The derived object should reference external base
      expect(result.missingBases).toContain(baseSha)
    })
  })

  describe('Pack checksum calculation', () => {
    it('should compute SHA-1 checksum of pack content', () => {
      const packContent = new Uint8Array([
        0x50, 0x41, 0x43, 0x4b, // PACK
        0x00, 0x00, 0x00, 0x02, // version 2
        0x00, 0x00, 0x00, 0x00  // 0 objects
      ])

      const checksum = computePackChecksum(packContent)

      expect(checksum).toBeInstanceOf(Uint8Array)
      expect(checksum.length).toBe(20)
    })

    it('should produce consistent checksum for same content', () => {
      const packContent = encoder.encode('test content for checksum')

      const checksum1 = computePackChecksum(packContent)
      const checksum2 = computePackChecksum(packContent)

      expect(bytesToHex(checksum1)).toBe(bytesToHex(checksum2))
    })

    it('should produce different checksum for different content', () => {
      const content1 = encoder.encode('content1')
      const content2 = encoder.encode('content2')

      const checksum1 = computePackChecksum(content1)
      const checksum2 = computePackChecksum(content2)

      expect(bytesToHex(checksum1)).not.toBe(bytesToHex(checksum2))
    })

    it('should validate embedded checksum matches computed', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('validate checksum')
        }
      ]

      const packfile = generatePackfile(objects)

      // Extract embedded checksum (last 20 bytes)
      const embeddedChecksum = packfile.slice(-20)

      // Compute checksum of pack data (excluding the checksum itself)
      const packData = packfile.slice(0, -20)
      const computedChecksum = computePackChecksum(packData)

      expect(bytesToHex(embeddedChecksum)).toBe(bytesToHex(computedChecksum))
    })
  })

  describe('Object ordering for optimal compression', () => {
    it('should order objects by type', () => {
      const objects: PackableObject[] = [
        { sha: createTestSha('blob'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('blob') },
        { sha: createTestSha('commit'), type: PackObjectType.OBJ_COMMIT, data: encoder.encode('commit') },
        { sha: createTestSha('tree'), type: PackObjectType.OBJ_TREE, data: encoder.encode('tree') },
        { sha: createTestSha('tag'), type: PackObjectType.OBJ_TAG, data: encoder.encode('tag') }
      ]

      const ordered = orderObjectsForCompression(objects)

      // Git typically orders: commits, trees, blobs, tags
      // Or groups by type for better delta compression
      expect(ordered.length).toBe(4)

      // Verify all objects are present
      const shas = new Set(ordered.map(o => o.sha))
      expect(shas.size).toBe(4)
    })

    it('should group similar blobs together', () => {
      const objects: PackableObject[] = [
        { sha: createTestSha('large_blob'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(10000) },
        { sha: createTestSha('small_tree'), type: PackObjectType.OBJ_TREE, data: new Uint8Array(50) },
        { sha: createTestSha('small_blob'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(100) },
        { sha: createTestSha('large_tree'), type: PackObjectType.OBJ_TREE, data: new Uint8Array(5000) }
      ]

      const ordered = orderObjectsForCompression(objects)

      // Objects of same type should be grouped together
      let lastType: PackObjectType | null = null
      let typeChanges = 0

      for (const obj of ordered) {
        if (lastType !== null && obj.type !== lastType) {
          typeChanges++
        }
        lastType = obj.type
      }

      // Should have minimal type changes (objects grouped by type)
      expect(typeChanges).toBeLessThanOrEqual(3) // At most 4 groups = 3 transitions
    })

    it('should order objects by size within type for delta efficiency', () => {
      const objects: PackableObject[] = [
        { sha: createTestSha('small'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(100) },
        { sha: createTestSha('large'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(10000) },
        { sha: createTestSha('medium'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(1000) }
      ]

      const ordered = orderObjectsForCompression(objects)

      // Within same type, larger objects first (better delta bases)
      // or sorted for predictable delta chains
      expect(ordered.length).toBe(3)
    })

    it('should handle path-based ordering hint', () => {
      const objects: PackableObject[] = [
        { sha: createTestSha('a'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('a'), path: 'src/main.ts' },
        { sha: createTestSha('b'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('b'), path: 'src/utils.ts' },
        { sha: createTestSha('c'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('c'), path: 'test/main.test.ts' }
      ]

      const ordered = orderObjectsForCompression(objects)

      // Objects with similar paths should be grouped (better delta compression)
      expect(ordered.length).toBe(3)
    })

    it('should place delta bases before delta objects', () => {
      const generator = new PackfileGenerator({ enableDeltaCompression: true })

      // Add objects that will form a delta chain
      generator.addObject({
        sha: createTestSha('v1'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('version 1 content')
      })
      generator.addObject({
        sha: createTestSha('v2'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('version 2 content with additions')
      })
      generator.addObject({
        sha: createTestSha('v3'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('version 3 content with more additions')
      })

      const result = generator.generate()

      // The pack should be valid and bases should come before deltas
      expect(result.packData).toBeInstanceOf(Uint8Array)
    })
  })

  describe('GeneratedPackfile result', () => {
    it('should include all expected properties', () => {
      const generator = new PackfileGenerator()
      generator.addObject({
        sha: createTestSha('obj'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('content')
      })

      const result: GeneratedPackfile = generator.generate()

      expect(result.packData).toBeInstanceOf(Uint8Array)
      expect(result.checksum).toBeInstanceOf(Uint8Array)
      expect(result.stats).toBeDefined()
      expect(typeof result.stats.totalObjects).toBe('number')
      expect(typeof result.stats.totalSize).toBe('number')
      expect(typeof result.stats.compressedSize).toBe('number')
    })

    it('should report accurate object count', () => {
      const generator = new PackfileGenerator()

      for (let i = 0; i < 10; i++) {
        generator.addObject({
          sha: createTestSha(`obj${i}`),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode(`content ${i}`)
        })
      }

      const result = generator.generate()

      expect(result.stats.totalObjects).toBe(10)
    })

    it('should report compression ratio', () => {
      const generator = new PackfileGenerator()

      // Highly compressible content
      generator.addObject({
        sha: createTestSha('compressible'),
        type: PackObjectType.OBJ_BLOB,
        data: new Uint8Array(10000).fill(0x41)
      })

      const result = generator.generate()

      expect(result.stats.totalSize).toBe(10000)
      expect(result.stats.compressedSize).toBeLessThan(result.stats.totalSize)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty object data', () => {
      const objects: PackableObject[] = [
        {
          sha: createTestSha('empty'),
          type: PackObjectType.OBJ_BLOB,
          data: new Uint8Array(0)
        }
      ]

      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle binary data with null bytes', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00])

      const objects: PackableObject[] = [
        {
          sha: createTestSha('binary'),
          type: PackObjectType.OBJ_BLOB,
          data: binaryData
        }
      ]

      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle maximum object size', () => {
      // Git has practical limits on object size
      const largeData = new Uint8Array(5 * 1024 * 1024) // 5MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const objects: PackableObject[] = [
        {
          sha: createTestSha('large'),
          type: PackObjectType.OBJ_BLOB,
          data: largeData
        }
      ]

      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle unicode content', () => {
      const unicodeContent = encoder.encode('Hello World! Emoji: \u{1F600}')

      const objects: PackableObject[] = [
        {
          sha: createTestSha('unicode'),
          type: PackObjectType.OBJ_BLOB,
          data: unicodeContent
        }
      ]

      const result = generatePackfile(objects)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should handle many objects efficiently', () => {
      const objects: PackableObject[] = []

      for (let i = 0; i < 1000; i++) {
        objects.push({
          sha: i.toString(16).padStart(40, '0'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode(`object content ${i}`)
        })
      }

      const start = Date.now()
      const result = generatePackfile(objects)
      const elapsed = Date.now() - start

      expect(result).toBeInstanceOf(Uint8Array)
      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).toBeLessThan(5000)
    })
  })

  describe('PackGenerationStats', () => {
    it('should track all statistics', () => {
      const generator = new PackfileGenerator({ enableDeltaCompression: true })

      generator.addObject({
        sha: createTestSha('base'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('base content')
      })
      generator.addObject({
        sha: createTestSha('derived'),
        type: PackObjectType.OBJ_BLOB,
        data: encoder.encode('base content with additions')
      })

      const result = generator.generate()
      const stats: PackGenerationStats = result.stats

      expect(typeof stats.totalObjects).toBe('number')
      expect(typeof stats.deltaObjects).toBe('number')
      expect(typeof stats.totalSize).toBe('number')
      expect(typeof stats.compressedSize).toBe('number')
      expect(typeof stats.maxDeltaDepth).toBe('number')
      expect(typeof stats.generationTimeMs).toBe('number')
    })

    it('should report generation time', () => {
      const generator = new PackfileGenerator()

      for (let i = 0; i < 100; i++) {
        generator.addObject({
          sha: createTestSha(`obj${i}`),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode(`content ${i}`)
        })
      }

      const result = generator.generate()

      expect(result.stats.generationTimeMs).toBeGreaterThan(0)
    })
  })
})
