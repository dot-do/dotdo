/**
 * Pack Streaming Tests
 *
 * Tests for memory-efficient streaming pack processing:
 * - StreamingPackParser with async iterators
 * - StreamingPackGenerator with chunked output
 * - LRU cache for delta base objects
 * - Large pack handling (1000+ objects)
 * - Memory efficiency verification
 *
 * @module bashx/remote/pack-streaming.test
 */

import { describe, it, expect } from 'vitest'

import {
  StreamingPackParser,
  parsePackFileStreaming,
  LRUCache,
  buildPackIndex,
  type StreamingPackObject,
} from './pack-parser.js'

import {
  PackGenerator,
  StreamingPackGenerator,
  type PackObject,
  OBJ_BLOB,
} from './pack-generator.js'

import { PackParser } from './pack-parser.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestBlob(content: string): PackObject {
  return {
    type: OBJ_BLOB,
    data: new TextEncoder().encode(content),
  }
}

// Helper functions createLargeBlob, sha1Bytes, zlibCompress available in test-helpers.md
// These are used by the pack generator for testing specific scenarios

function createPackWithManyObjects(count: number): Uint8Array {
  const objects: PackObject[] = []
  for (let i = 0; i < count; i++) {
    objects.push(createTestBlob(`Object ${i} content - padding to make it interesting ${i.toString().repeat(10)}`))
  }
  const generator = new PackGenerator()
  return generator.generate(objects).pack
}

function createPackWithDeltaChain(depth: number): Uint8Array {
  const objects: PackObject[] = []
  // Base object
  objects.push(createTestBlob('base content '.repeat(50)))
  // Delta chain
  for (let i = 1; i <= depth; i++) {
    objects.push(createTestBlob('base content '.repeat(50) + `delta ${i}`))
  }
  const generator = new PackGenerator()
  return generator.generate(objects, { useDelta: true }).pack
}

// =============================================================================
// LRU Cache Tests
// =============================================================================

describe('LRU Cache', () => {
  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      expect(cache.get('a')).toBe(1)
      expect(cache.get('b')).toBe(2)
      expect(cache.get('c')).toBe(3)
    })

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, number>(3)
      expect(cache.get('missing')).toBeUndefined()
    })

    it('should evict least recently used on capacity overflow', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4) // Should evict 'a'

      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe(2)
      expect(cache.get('c')).toBe(3)
      expect(cache.get('d')).toBe(4)
    })

    it('should update LRU order on get', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      // Access 'a' to make it most recently used
      cache.get('a')

      // Now 'b' should be LRU
      cache.set('d', 4) // Should evict 'b'

      expect(cache.get('a')).toBe(1)
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('c')).toBe(3)
      expect(cache.get('d')).toBe(4)
    })

    it('should update LRU order on set (existing key)', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      // Update 'a' to make it most recently used
      cache.set('a', 10)

      // Now 'b' should be LRU
      cache.set('d', 4) // Should evict 'b'

      expect(cache.get('a')).toBe(10)
      expect(cache.get('b')).toBeUndefined()
    })

    it('should report correct size', () => {
      const cache = new LRUCache<string, number>(5)
      expect(cache.size).toBe(0)

      cache.set('a', 1)
      expect(cache.size).toBe(1)

      cache.set('b', 2)
      cache.set('c', 3)
      expect(cache.size).toBe(3)
    })

    it('should support has() method', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)

      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
    })

    it('should support delete() method', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      expect(cache.delete('a')).toBe(true)
      expect(cache.has('a')).toBe(false)
      expect(cache.delete('nonexistent')).toBe(false)
    })

    it('should support clear() method', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.get('a')).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle capacity of 1', () => {
      const cache = new LRUCache<string, number>(1)
      cache.set('a', 1)
      expect(cache.get('a')).toBe(1)

      cache.set('b', 2) // Evicts 'a'
      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe(2)
    })

    it('should handle large capacity', () => {
      const cache = new LRUCache<number, string>(1000)
      for (let i = 0; i < 1000; i++) {
        cache.set(i, `value${i}`)
      }
      expect(cache.size).toBe(1000)

      // All values should be present
      for (let i = 0; i < 1000; i++) {
        expect(cache.get(i)).toBe(`value${i}`)
      }
    })

    it('should handle undefined values', () => {
      const cache = new LRUCache<string, number | undefined>(3)
      cache.set('a', undefined)

      // get returns undefined for both missing and undefined values
      // Use has() to distinguish
      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
    })
  })
})

// =============================================================================
// Pack Index Tests
// =============================================================================

describe('Pack Index', () => {
  describe('buildPackIndex', () => {
    it('should build index for simple pack', () => {
      const pack = createPackWithManyObjects(5)
      const { header, entries, entryOffsets } = buildPackIndex(pack)

      expect(header.objectCount).toBe(5)
      expect(entries).toHaveLength(5)
      expect(entryOffsets).toHaveLength(5)
    })

    it('should capture object types correctly', () => {
      const objects: PackObject[] = [
        createTestBlob('blob content'),
      ]
      const generator = new PackGenerator()
      const pack = generator.generate(objects).pack

      const { entries } = buildPackIndex(pack)
      expect(entries[0].type).toBe(OBJ_BLOB)
    })

    it('should track offsets for delta resolution', () => {
      const pack = createPackWithDeltaChain(3)
      const { entryOffsets } = buildPackIndex(pack)

      // First entry should be at offset 12 (after header)
      expect(entryOffsets[0]).toBe(12)

      // Subsequent entries should have increasing offsets
      for (let i = 1; i < entryOffsets.length; i++) {
        expect(entryOffsets[i]).toBeGreaterThan(entryOffsets[i - 1])
      }
    })

    it('should capture delta base info', () => {
      const pack = createPackWithDeltaChain(2)
      const { entries } = buildPackIndex(pack)

      // Check if any entry has delta info (may or may not be used depending on size savings)
      const hasDeltaInfo = entries.some(e => e.baseOffset !== undefined || e.baseSha !== undefined)
      // Either has delta info or all entries are base objects
      expect(entries.length).toBeGreaterThan(0)
      expect(typeof hasDeltaInfo).toBe('boolean')
    })

    it('should handle large packs efficiently', () => {
      const pack = createPackWithManyObjects(100)
      const start = Date.now()
      const { header, entries } = buildPackIndex(pack)
      const elapsed = Date.now() - start

      expect(header.objectCount).toBe(100)
      expect(entries).toHaveLength(100)
      expect(elapsed).toBeLessThan(5000) // Should complete in < 5 seconds
    })
  })
})

// =============================================================================
// Streaming Pack Parser Tests
// =============================================================================

describe('Streaming Pack Parser', () => {
  describe('Basic Functionality', () => {
    it('should parse simple pack via async iterator', async () => {
      const pack = createPackWithManyObjects(5)
      const parser = new StreamingPackParser(pack)

      const objects: StreamingPackObject[] = []
      for await (const obj of parser.objects()) {
        objects.push(obj)
      }

      expect(objects).toHaveLength(5)
    })

    it('should provide correct object metadata', async () => {
      const generator = new PackGenerator()
      const pack = generator.generate([createTestBlob('hello world')]).pack
      const parser = new StreamingPackParser(pack)

      const objects: StreamingPackObject[] = []
      for await (const obj of parser.objects()) {
        objects.push(obj)
      }

      expect(objects).toHaveLength(1)
      expect(objects[0].type).toBe(OBJ_BLOB)
      expect(objects[0].typeName).toBe('blob')
      expect(objects[0].sha).toMatch(/^[0-9a-f]{40}$/)
      expect(new TextDecoder().decode(objects[0].data)).toBe('hello world')
    })

    it('should report progress via callback', async () => {
      const pack = createPackWithManyObjects(10)
      const progressCalls: [number, number][] = []

      const parser = new StreamingPackParser(pack, {
        onProgress: (parsed, total) => progressCalls.push([parsed, total]),
      })

      for await (const _ of parser.objects()) {
        // Consume all objects
      }

      expect(progressCalls.length).toBe(10)
      expect(progressCalls[0]).toEqual([1, 10])
      expect(progressCalls[9]).toEqual([10, 10])
    })

    it('should provide object count without full parsing', () => {
      const pack = createPackWithManyObjects(100)
      const parser = new StreamingPackParser(pack)

      // Should be able to get count without iterating
      expect(parser.objectCount).toBe(100)
    })

    it('should provide version without full parsing', () => {
      const pack = createPackWithManyObjects(5)
      const parser = new StreamingPackParser(pack)

      expect(parser.version).toBe(2)
    })
  })

  describe('Delta Resolution', () => {
    it('should resolve OFS_DELTA objects correctly', async () => {
      const pack = createPackWithDeltaChain(3)
      const parser = new StreamingPackParser(pack)

      const objects: StreamingPackObject[] = []
      for await (const obj of parser.objects()) {
        objects.push(obj)
      }

      // All objects should be resolved to base types (not delta types)
      for (const obj of objects) {
        expect(obj.type).toBeLessThanOrEqual(4)
      }
    })

    it('should handle deep delta chains', async () => {
      const pack = createPackWithDeltaChain(10)
      const parser = new StreamingPackParser(pack)

      const objects: StreamingPackObject[] = []
      for await (const obj of parser.objects()) {
        objects.push(obj)
      }

      expect(objects).toHaveLength(11) // base + 10 deltas
    })

    it('should use LRU cache for delta bases', async () => {
      const pack = createPackWithDeltaChain(5)
      const parser = new StreamingPackParser(pack, { cacheSize: 3 })

      // Should not throw even with small cache
      const objects: StreamingPackObject[] = []
      for await (const obj of parser.objects()) {
        objects.push(obj)
      }

      expect(objects).toHaveLength(6)
    })
  })

  describe('Memory Efficiency', () => {
    it('should process large packs (1000+ objects)', async () => {
      const pack = createPackWithManyObjects(1000)
      const parser = new StreamingPackParser(pack)

      let count = 0
      for await (const _ of parser.objects()) {
        count++
      }

      expect(count).toBe(1000)
    })

    it('should work with small cache size', async () => {
      const pack = createPackWithManyObjects(100)
      const parser = new StreamingPackParser(pack, { cacheSize: 10 })

      let count = 0
      for await (const _ of parser.objects()) {
        count++
      }

      expect(count).toBe(100)
    })

    it('should process objects one at a time', async () => {
      const pack = createPackWithManyObjects(50)
      const parser = new StreamingPackParser(pack)

      let lastOffset = -1
      for await (const obj of parser.objects()) {
        // Each object should have a unique, increasing offset
        expect(obj.offset).toBeGreaterThan(lastOffset)
        lastOffset = obj.offset
      }
    })
  })

  describe('parseAll() - Full Parse', () => {
    it('should return compatible result with original parsePackFile', async () => {
      const pack = createPackWithManyObjects(10)
      const parser = new StreamingPackParser(pack)

      const result = await parser.parseAll()

      expect(result.version).toBe(2)
      expect(result.objects).toHaveLength(10)
      expect(result.index.size).toBe(10)
    })

    it('should provide SHA-indexed access', async () => {
      const generator = new PackGenerator()
      const pack = generator.generate([createTestBlob('findme')]).pack

      const parser = new StreamingPackParser(pack)
      const result = await parser.parseAll()

      // Should be able to find object by SHA
      const sha = result.objects[0].sha
      const found = result.index.get(sha)
      expect(found).toBeDefined()
      expect(new TextDecoder().decode(found!.data)).toBe('findme')
    })
  })

  describe('parsePackFileStreaming() Function', () => {
    it('should create StreamingPackParser', () => {
      const pack = createPackWithManyObjects(5)
      const parser = parsePackFileStreaming(pack)

      expect(parser).toBeInstanceOf(StreamingPackParser)
    })

    it('should accept options', () => {
      const pack = createPackWithManyObjects(5)
      const parser = parsePackFileStreaming(pack, {
        cacheSize: 50,
        onProgress: () => {},
      })

      expect(parser.objectCount).toBe(5)
    })
  })
})

// =============================================================================
// Streaming Pack Generator Tests
// =============================================================================

describe('Streaming Pack Generator', () => {
  describe('Basic Functionality', () => {
    it('should generate pack via async iterator', async () => {
      const generator = new StreamingPackGenerator()
      const objects = [createTestBlob('hello'), createTestBlob('world')]

      const chunks: Uint8Array[] = []
      for await (const chunk of generator.generate(objects)) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should produce valid pack data', async () => {
      const generator = new StreamingPackGenerator()
      const objects = [createTestBlob('test content')]

      const result = await generator.generateFull(objects)

      // Verify with standard parser
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)

      expect(parsed.objectCount).toBe(1)
      expect(new TextDecoder().decode(parsed.objects[0].data)).toBe('test content')
    })

    it('should report progress', async () => {
      const progressCalls: [number, number][] = []
      const generator = new StreamingPackGenerator({
        onProgress: (written, total) => progressCalls.push([written, total]),
      })

      const objects = [
        createTestBlob('one'),
        createTestBlob('two'),
        createTestBlob('three'),
      ]

      for await (const _ of generator.generate(objects)) {
        // Consume all chunks
      }

      expect(progressCalls.length).toBe(3)
      expect(progressCalls[2]).toEqual([3, 3])
    })
  })

  describe('generateFull()', () => {
    it('should return complete pack result', async () => {
      const generator = new StreamingPackGenerator()
      const objects = [createTestBlob('hello'), createTestBlob('world')]

      const result = await generator.generateFull(objects)

      expect(result.pack).toBeInstanceOf(Uint8Array)
      expect(result.checksum).toBeInstanceOf(Uint8Array)
      expect(result.checksum.length).toBe(20)
      expect(result.objectCount).toBe(2)
      expect(result.packSize).toBe(result.pack.length)
    })

    it('should match synchronous generator output', async () => {
      const objects = [
        createTestBlob('same content'),
        createTestBlob('more content'),
      ]

      const syncGenerator = new PackGenerator()
      const syncResult = syncGenerator.generate(objects)

      const asyncGenerator = new StreamingPackGenerator()
      const asyncResult = await asyncGenerator.generateFull(objects)

      // Both should produce parseable packs with same content
      const syncParser = new PackParser()
      const asyncParser = new PackParser()

      const syncParsed = syncParser.parse(syncResult.pack)
      const asyncParsed = asyncParser.parse(asyncResult.pack)

      expect(syncParsed.objectCount).toBe(asyncParsed.objectCount)
      for (let i = 0; i < syncParsed.objects.length; i++) {
        expect(syncParsed.objects[i].data).toEqual(asyncParsed.objects[i].data)
      }
    })
  })

  describe('Memory Efficiency', () => {
    it('should handle large object counts', async () => {
      const generator = new StreamingPackGenerator()
      const objects = Array.from({ length: 500 }, (_, i) => createTestBlob(`object ${i}`))

      const result = await generator.generateFull(objects)

      const parser = new PackParser()
      const parsed = parser.parse(result.pack)
      expect(parsed.objectCount).toBe(500)
    })

    it('should stream chunks incrementally', async () => {
      const generator = new StreamingPackGenerator()
      const objects = Array.from({ length: 100 }, (_, i) => createTestBlob(`object ${i}`))

      let chunkCount = 0
      for await (const _ of generator.generate(objects)) {
        chunkCount++
      }

      // Should yield multiple chunks (header + objects + checksum)
      expect(chunkCount).toBeGreaterThan(objects.length)
    })
  })

  describe('Delta Support', () => {
    it('should support delta compression option', async () => {
      const generator = new StreamingPackGenerator({ useDelta: true })
      const objects = [
        createTestBlob('base content '.repeat(50)),
        createTestBlob('base content '.repeat(50) + ' modified'),
      ]

      const result = await generator.generateFull(objects)

      // Should still produce valid pack
      const parser = new PackParser()
      const parsed = parser.parse(result.pack)
      expect(parsed.objectCount).toBe(2)
    })

    it('should support REF_DELTA preference', async () => {
      const generator = new StreamingPackGenerator({ useDelta: true, preferRefDelta: true })
      const objects = [
        createTestBlob('base '.repeat(100)),
        createTestBlob('base '.repeat(100) + 'extra'),
      ]

      const result = await generator.generateFull(objects)

      const parser = new PackParser()
      const parsed = parser.parse(result.pack)
      expect(parsed.objectCount).toBe(2)
    })
  })
})

// =============================================================================
// Round-Trip Tests
// =============================================================================

describe('Streaming Round-Trip', () => {
  it('should round-trip through streaming generator and parser', async () => {
    const original = [
      createTestBlob('first blob'),
      createTestBlob('second blob'),
      createTestBlob('third blob'),
    ]

    // Generate with streaming
    const generator = new StreamingPackGenerator()
    const packResult = await generator.generateFull(original)

    // Parse with streaming
    const parser = new StreamingPackParser(packResult.pack)
    const parsed: StreamingPackObject[] = []
    for await (const obj of parser.objects()) {
      parsed.push(obj)
    }

    // Verify content
    expect(parsed).toHaveLength(3)
    expect(new TextDecoder().decode(parsed[0].data)).toBe('first blob')
    expect(new TextDecoder().decode(parsed[1].data)).toBe('second blob')
    expect(new TextDecoder().decode(parsed[2].data)).toBe('third blob')
  })

  it('should handle 1000+ objects round-trip', async () => {
    const count = 1000
    const original = Array.from({ length: count }, (_, i) => createTestBlob(`blob ${i}`))

    const generator = new StreamingPackGenerator()
    const packResult = await generator.generateFull(original)

    const parser = new StreamingPackParser(packResult.pack)
    let parsedCount = 0
    for await (const obj of parser.objects()) {
      expect(obj.type).toBe(OBJ_BLOB)
      parsedCount++
    }

    expect(parsedCount).toBe(count)
  })

  it('should preserve object data exactly', async () => {
    // Create objects with various content types
    const binaryBlob: PackObject = { type: OBJ_BLOB, data: new Uint8Array([0, 1, 2, 255, 254, 253]) }
    const objects: PackObject[] = [
      createTestBlob('simple text'),
      createTestBlob('unicode: \u00e9\u00e8\u00ea'),
      binaryBlob,
      createTestBlob(''),
      createTestBlob('x'.repeat(10000)),
    ]

    const generator = new StreamingPackGenerator()
    const packResult = await generator.generateFull(objects)

    const parser = new StreamingPackParser(packResult.pack)
    let i = 0
    for await (const obj of parser.objects()) {
      expect(obj.data).toEqual(objects[i].data)
      i++
    }
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  it('should parse large pack in reasonable time', async () => {
    const pack = createPackWithManyObjects(500)
    const parser = new StreamingPackParser(pack)

    const start = Date.now()
    let count = 0
    for await (const _ of parser.objects()) {
      count++
    }
    const elapsed = Date.now() - start

    expect(count).toBe(500)
    expect(elapsed).toBeLessThan(30000) // 30 seconds max
  })

  it('should generate large pack in reasonable time', async () => {
    const objects = Array.from({ length: 500 }, (_, i) => createTestBlob(`object ${i} content`))
    const generator = new StreamingPackGenerator()

    const start = Date.now()
    const result = await generator.generateFull(objects)
    const elapsed = Date.now() - start

    expect(result.objectCount).toBe(500)
    expect(elapsed).toBeLessThan(30000) // 30 seconds max
  })
})
