/**
 * CompressionEngine Tests
 * TDD Red-Green-Refactor implementation
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CompressionEngine,
  GzipCompressor,
  DeflateCompressor,
  LZ4Compressor,
  DictionaryCompressor,
  AdaptiveCompressor,
  ChunkedCompressor,
} from './index'
import type {
  CompressionAlgorithm,
  CompressionLevel,
  CompressionResult,
  CompressionStats,
  BenchmarkResult,
} from './types'
import { CompressionError } from './types'

describe('CompressionEngine', () => {
  let engine: CompressionEngine

  beforeEach(() => {
    engine = new CompressionEngine()
  })

  describe('Basic compress/decompress', () => {
    it('should compress and decompress text data', async () => {
      const input = new TextEncoder().encode('Hello, World!')
      const compressed = await engine.compress(input, 'gzip')

      expect(compressed.data).toBeInstanceOf(Uint8Array)
      expect(compressed.originalSize).toBe(input.length)
      expect(compressed.compressedSize).toBe(compressed.data.length)
      expect(compressed.ratio).toBe(compressed.compressedSize / compressed.originalSize)

      const decompressed = await engine.decompress(compressed.data, 'gzip')
      expect(decompressed.data).toEqual(input)
    })

    it('should compress repetitive data efficiently', async () => {
      const input = new TextEncoder().encode('a'.repeat(1000))
      const compressed = await engine.compress(input, 'gzip')

      expect(compressed.compressedSize).toBeLessThan(compressed.originalSize)
      expect(compressed.ratio).toBeLessThan(1)
    })

    it('should handle empty data', async () => {
      const input = new Uint8Array(0)
      const compressed = await engine.compress(input, 'gzip')

      expect(compressed.originalSize).toBe(0)

      const decompressed = await engine.decompress(compressed.data, 'gzip')
      expect(decompressed.data.length).toBe(0)
    })
  })

  describe('Multiple algorithms', () => {
    const algorithms: CompressionAlgorithm[] = ['gzip', 'deflate', 'brotli', 'lz4', 'snappy']
    const testData = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(100))

    for (const algorithm of algorithms) {
      it(`should compress/decompress with ${algorithm}`, async () => {
        const compressed = await engine.compress(testData, algorithm)
        expect(compressed.data.length).toBeGreaterThan(0)

        const decompressed = await engine.decompress(compressed.data, algorithm)
        expect(decompressed.data).toEqual(testData)
      })
    }
  })

  describe('Compression levels', () => {
    const testData = new TextEncoder().encode('Compression level test data. '.repeat(500))

    it('should support numeric levels 1-9', async () => {
      const levels: CompressionLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      const results: CompressionResult[] = []

      for (const level of levels) {
        const result = await engine.compress(testData, 'gzip', level)
        results.push(result)
      }

      // Higher levels should generally produce smaller output (not always guaranteed)
      // but all should be valid
      for (const result of results) {
        const decompressed = await engine.decompress(result.data, 'gzip')
        expect(decompressed.data).toEqual(testData)
      }
    })

    it('should support named levels', async () => {
      const fastResult = await engine.compress(testData, 'gzip', 'fast')
      const defaultResult = await engine.compress(testData, 'gzip', 'default')
      const bestResult = await engine.compress(testData, 'gzip', 'best')

      // All should decompress correctly
      for (const result of [fastResult, defaultResult, bestResult]) {
        const decompressed = await engine.decompress(result.data, 'gzip')
        expect(decompressed.data).toEqual(testData)
      }

      // Best should generally be smaller or equal to fast
      expect(bestResult.compressedSize).toBeLessThanOrEqual(fastResult.compressedSize + 50)
    })
  })

  describe('Stream compression', () => {
    it('should provide a compression stream', async () => {
      const input = new TextEncoder().encode('Stream compression test data. '.repeat(1000))

      const compressStream = engine.compressStream('gzip')
      const decompressStream = engine.decompressStream('gzip')

      // Check for TransformStream-like interface (readable/writable properties)
      expect(compressStream).toHaveProperty('readable')
      expect(compressStream).toHaveProperty('writable')
      expect(decompressStream).toHaveProperty('readable')
      expect(decompressStream).toHaveProperty('writable')
    })

    it('should compress data through stream', async () => {
      const input = new TextEncoder().encode('Streaming data test. '.repeat(500))
      const chunks: Uint8Array[] = []

      const compressStream = engine.compressStream('gzip')
      const writer = compressStream.writable.getWriter()
      const reader = compressStream.readable.getReader()

      // Write input
      await writer.write(input)
      await writer.close()

      // Read compressed output
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      const compressed = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        compressed.set(chunk, offset)
        offset += chunk.length
      }

      // Decompress and verify
      const decompressed = await engine.decompress(compressed, 'gzip')
      expect(decompressed.data).toEqual(input)
    })

    it('should support stream options', async () => {
      const stream = engine.compressStream('gzip', { chunkSize: 1024, flush: 'sync' })
      // Check for TransformStream-like interface
      expect(stream).toHaveProperty('readable')
      expect(stream).toHaveProperty('writable')
    })
  })

  describe('Large data handling', () => {
    it('should handle 1MB of data', async () => {
      const size = 1024 * 1024 // 1MB
      const input = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        input[i] = i % 256
      }

      const compressed = await engine.compress(input, 'gzip')
      expect(compressed.originalSize).toBe(size)

      const decompressed = await engine.decompress(compressed.data, 'gzip')
      expect(decompressed.data).toEqual(input)
    })

    it('should handle 5MB of random-like data', async () => {
      const size = 5 * 1024 * 1024 // 5MB
      const input = new Uint8Array(size)
      // Pseudo-random but deterministic
      let seed = 12345
      for (let i = 0; i < size; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        input[i] = seed % 256
      }

      const compressed = await engine.compress(input, 'lz4')
      const decompressed = await engine.decompress(compressed.data, 'lz4')
      expect(decompressed.data).toEqual(input)
    }, 30000) // 30s timeout for large data
  })

  describe('Binary data', () => {
    it('should handle binary data with null bytes', async () => {
      const input = new Uint8Array([0, 1, 0, 2, 0, 3, 0, 0, 0, 255, 254, 253])
      const compressed = await engine.compress(input, 'gzip')
      const decompressed = await engine.decompress(compressed.data, 'gzip')
      expect(decompressed.data).toEqual(input)
    })

    it('should handle all byte values', async () => {
      const input = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        input[i] = i
      }

      const compressed = await engine.compress(input, 'deflate')
      const decompressed = await engine.decompress(compressed.data, 'deflate')
      expect(decompressed.data).toEqual(input)
    })
  })

  describe('UTF-8 text', () => {
    it('should handle UTF-8 text with emojis', async () => {
      const text = 'Hello, World! \u{1F600}\u{1F389}\u{1F680}'
      const input = new TextEncoder().encode(text)

      const compressed = await engine.compress(input, 'gzip')
      const decompressed = await engine.decompress(compressed.data, 'gzip')

      const result = new TextDecoder().decode(decompressed.data)
      expect(result).toBe(text)
    })

    it('should handle multi-byte UTF-8 characters', async () => {
      const text = '\u4e2d\u6587\u0420\u0443\u0441\u0441\u043a\u0438\u0439\u65e5\u672c\u8a9e\ud55c\uad6d\uc5b4'
      const input = new TextEncoder().encode(text)

      const compressed = await engine.compress(input, 'brotli')
      const decompressed = await engine.decompress(compressed.data, 'brotli')

      const result = new TextDecoder().decode(decompressed.data)
      expect(result).toBe(text)
    })
  })

  describe('Compression ratio calculation', () => {
    it('should calculate correct ratio for compressible data', async () => {
      const input = new TextEncoder().encode('aaaaaaaaaa'.repeat(1000)) // Very compressible
      const result = await engine.compress(input, 'gzip')

      expect(result.ratio).toBe(result.compressedSize / result.originalSize)
      expect(result.ratio).toBeLessThan(0.1) // Should be highly compressible
    })

    it('should handle ratio > 1 for incompressible data', async () => {
      // Small random data may expand
      const input = new Uint8Array([1, 2, 3, 4, 5])
      const result = await engine.compress(input, 'gzip')

      expect(result.ratio).toBe(result.compressedSize / result.originalSize)
      // Ratio can be > 1 for very small data due to headers
    })
  })

  describe('Algorithm detection', () => {
    it('should detect gzip format', async () => {
      const input = new TextEncoder().encode('Test data for detection')
      const compressed = await engine.compress(input, 'gzip')

      const detected = engine.detectAlgorithm(compressed.data)
      expect(detected).toBe('gzip')
    })

    it('should detect deflate format', async () => {
      const input = new TextEncoder().encode('Test data for detection')
      const compressed = await engine.compress(input, 'deflate')

      const detected = engine.detectAlgorithm(compressed.data)
      expect(detected).toBe('deflate')
    })

    it('should return null for uncompressed data', () => {
      const input = new TextEncoder().encode('Plain text data')
      const detected = engine.detectAlgorithm(input)
      expect(detected).toBeNull()
    })

    it('should detect brotli format', async () => {
      const input = new TextEncoder().encode('Test data for brotli detection')
      const compressed = await engine.compress(input, 'brotli')

      const detected = engine.detectAlgorithm(compressed.data)
      expect(detected).toBe('brotli')
    })
  })

  describe('Benchmark comparison', () => {
    it('should benchmark all algorithms', async () => {
      const input = new TextEncoder().encode('Benchmark test data. '.repeat(1000))
      const result = await engine.benchmark(input)

      expect(result.bestAlgorithm).toBeDefined()
      expect(result.bestRatio).toBeGreaterThan(0)
      expect(result.fastestAlgorithm).toBeDefined()
      expect(result.fastestDuration).toBeGreaterThan(0)
      expect(result.results).toHaveLength(5) // All 5 algorithms
    })

    it('should provide stats for each algorithm', async () => {
      const input = new TextEncoder().encode('Stats test data. '.repeat(500))
      const result = await engine.benchmark(input)

      for (const stats of result.results) {
        expect(stats.algorithm).toBeDefined()
        expect(stats.level).toBeDefined()
        expect(stats.duration).toBeGreaterThanOrEqual(0)
        expect(stats.ratio).toBeGreaterThan(0)
        expect(stats.originalSize).toBe(input.length)
        expect(stats.compressedSize).toBeGreaterThan(0)
        expect(stats.throughput).toBeGreaterThan(0)
      }
    })

    it('should benchmark specific algorithms only', async () => {
      const input = new TextEncoder().encode('Limited benchmark. '.repeat(200))
      const result = await engine.benchmark(input, ['gzip', 'lz4'])

      expect(result.results).toHaveLength(2)
      expect(result.results.map(r => r.algorithm)).toContain('gzip')
      expect(result.results.map(r => r.algorithm)).toContain('lz4')
    })
  })

  describe('Error handling', () => {
    it('should throw on corrupt gzip data', async () => {
      const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff])

      await expect(engine.decompress(corrupt, 'gzip')).rejects.toThrow(CompressionError)
    })

    it('should throw on corrupt deflate data', async () => {
      const corrupt = new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff])

      await expect(engine.decompress(corrupt, 'deflate')).rejects.toThrow(CompressionError)
    })

    it('should throw on completely invalid data', async () => {
      const invalid = new TextEncoder().encode('This is not compressed')

      await expect(engine.decompress(invalid, 'gzip')).rejects.toThrow(CompressionError)
    })

    it('should include algorithm in error', async () => {
      const invalid = new Uint8Array([1, 2, 3])

      try {
        await engine.decompress(invalid, 'gzip')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CompressionError)
        expect((e as CompressionError).algorithm).toBe('gzip')
      }
    })
  })

  describe('Dictionary compression', () => {
    it('should compress with custom dictionary', async () => {
      const dictionary = new TextEncoder().encode('common words and phrases')
      const input = new TextEncoder().encode('common words and common phrases')

      const result = await engine.compress(input, 'deflate', 'default', { dictionary })
      expect(result.data.length).toBeGreaterThan(0)
    })

    it('should decompress with same dictionary', async () => {
      const dictionary = new TextEncoder().encode('repeated pattern')
      const input = new TextEncoder().encode('repeated pattern repeated pattern repeated')

      const compressed = await engine.compress(input, 'deflate', 'default', { dictionary })
      const decompressed = await engine.decompress(compressed.data, 'deflate', { dictionary })

      expect(decompressed.data).toEqual(input)
    })

    it('should use preset dictionaries', async () => {
      const jsonData = new TextEncoder().encode('{"name":"test","value":123,"items":[1,2,3]}')

      const result = await engine.compress(jsonData, 'deflate', 'default', {
        dictionary: { preset: 'json' }
      })

      expect(result.data.length).toBeGreaterThan(0)
    })
  })
})

describe('GzipCompressor', () => {
  let compressor: GzipCompressor

  beforeEach(() => {
    compressor = new GzipCompressor()
  })

  it('should have gzip algorithm', () => {
    expect(compressor.algorithm).toBe('gzip')
  })

  it('should compress data', async () => {
    const input = new TextEncoder().encode('Gzip test data')
    const compressed = await compressor.compress(input)

    expect(compressed).toBeInstanceOf(Uint8Array)
    expect(compressed.length).toBeGreaterThan(0)
  })

  it('should decompress data', async () => {
    const input = new TextEncoder().encode('Gzip roundtrip test')
    const compressed = await compressor.compress(input)
    const decompressed = await compressor.decompress(compressed)

    expect(decompressed).toEqual(input)
  })

  it('should detect gzip magic bytes', () => {
    const gzipData = new Uint8Array([0x1f, 0x8b, 0x08, 0x00])
    expect(compressor.detect(gzipData)).toBe(true)

    const plainData = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(compressor.detect(plainData)).toBe(false)
  })
})

describe('DeflateCompressor', () => {
  let compressor: DeflateCompressor

  beforeEach(() => {
    compressor = new DeflateCompressor()
  })

  it('should have deflate algorithm', () => {
    expect(compressor.algorithm).toBe('deflate')
  })

  it('should compress and decompress', async () => {
    const input = new TextEncoder().encode('Deflate test data')
    const compressed = await compressor.compress(input)
    const decompressed = await compressor.decompress(compressed)

    expect(decompressed).toEqual(input)
  })

  it('should detect deflate format', () => {
    // zlib header
    const deflateData = new Uint8Array([0x78, 0x9c])
    expect(compressor.detect(deflateData)).toBe(true)
  })
})

describe('LZ4Compressor', () => {
  let compressor: LZ4Compressor

  beforeEach(() => {
    compressor = new LZ4Compressor()
  })

  it('should have lz4 algorithm', () => {
    expect(compressor.algorithm).toBe('lz4')
  })

  it('should compress and decompress', async () => {
    const input = new TextEncoder().encode('LZ4 fast compression test data')
    const compressed = await compressor.compress(input)
    const decompressed = await compressor.decompress(compressed)

    expect(decompressed).toEqual(input)
  })

  it('should be fast for large data', async () => {
    const input = new Uint8Array(100000)
    for (let i = 0; i < input.length; i++) {
      input[i] = i % 256
    }

    const start = performance.now()
    const compressed = await compressor.compress(input)
    const duration = performance.now() - start

    // LZ4 should be fast
    expect(duration).toBeLessThan(1000)

    const decompressed = await compressor.decompress(compressed)
    expect(decompressed).toEqual(input)
  })
})

describe('DictionaryCompressor', () => {
  let compressor: DictionaryCompressor

  beforeEach(() => {
    compressor = new DictionaryCompressor()
  })

  it('should compress with dictionary', async () => {
    const dictionary = new TextEncoder().encode('hello world')
    const input = new TextEncoder().encode('hello world hello')

    const compressed = await compressor.compress(input, 'default', { dictionary })
    const decompressed = await compressor.decompress(compressed, { dictionary })

    expect(decompressed).toEqual(input)
  })

  it('should use preset dictionaries', async () => {
    const jsonInput = new TextEncoder().encode('{"key":"value","array":[1,2,3]}')

    const compressed = await compressor.compress(jsonInput, 'default', { dictionary: { preset: 'json' } })
    const decompressed = await compressor.decompress(compressed, { dictionary: { preset: 'json' } })

    expect(decompressed).toEqual(jsonInput)
  })
})

describe('AdaptiveCompressor', () => {
  let compressor: AdaptiveCompressor

  beforeEach(() => {
    compressor = new AdaptiveCompressor()
  })

  it('should auto-select best algorithm', async () => {
    const input = new TextEncoder().encode('Adaptive compression test. '.repeat(100))

    const result = await compressor.compress(input)
    expect(result.data).toBeInstanceOf(Uint8Array)
    expect(result.algorithm).toBeDefined()
  })

  it('should decompress auto-detected format', async () => {
    const input = new TextEncoder().encode('Auto-detect decompression test. '.repeat(50))

    const compressed = await compressor.compress(input)
    const decompressed = await compressor.decompress(compressed.data)

    expect(decompressed).toEqual(input)
  })

  it('should prefer speed for large data', async () => {
    const largeInput = new Uint8Array(1000000)
    for (let i = 0; i < largeInput.length; i++) {
      largeInput[i] = i % 256
    }

    const result = await compressor.compress(largeInput, { preferSpeed: true })
    // Should select a fast algorithm like lz4
    expect(['lz4', 'snappy']).toContain(result.algorithm)
  })

  it('should prefer ratio for small data', async () => {
    const smallInput = new TextEncoder().encode('Small compressible text. '.repeat(10))

    const result = await compressor.compress(smallInput, { preferRatio: true })
    // Should select a high-ratio algorithm like brotli or gzip
    expect(['brotli', 'gzip', 'deflate']).toContain(result.algorithm)
  })
})

describe('ChunkedCompressor', () => {
  let compressor: ChunkedCompressor

  beforeEach(() => {
    compressor = new ChunkedCompressor({ chunkSize: 1024 })
  })

  it('should compress large data in chunks', async () => {
    const input = new Uint8Array(10000)
    for (let i = 0; i < input.length; i++) {
      input[i] = i % 256
    }

    const compressed = await compressor.compress(input, 'gzip')
    const decompressed = await compressor.decompress(compressed, 'gzip')

    expect(decompressed).toEqual(input)
  })

  it('should handle data smaller than chunk size', async () => {
    const input = new TextEncoder().encode('Small data')

    const compressed = await compressor.compress(input, 'gzip')
    const decompressed = await compressor.decompress(compressed, 'gzip')

    expect(decompressed).toEqual(input)
  })

  it('should support custom chunk size', async () => {
    const customCompressor = new ChunkedCompressor({ chunkSize: 512 })
    const input = new Uint8Array(2000)

    const compressed = await customCompressor.compress(input, 'deflate')
    const decompressed = await customCompressor.decompress(compressed, 'deflate')

    expect(decompressed).toEqual(input)
  })

  it('should provide progress callback', async () => {
    const input = new Uint8Array(5000)
    const progressUpdates: number[] = []

    await compressor.compress(input, 'gzip', {
      onProgress: (progress) => progressUpdates.push(progress)
    })

    expect(progressUpdates.length).toBeGreaterThan(0)
    expect(progressUpdates[progressUpdates.length - 1]).toBe(1)
  })
})
