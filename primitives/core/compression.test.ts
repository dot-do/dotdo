/**
 * Compression utilities tests
 * @module primitives-core/compression.test
 */
import { describe, test, expect } from 'vitest'
import { compress, decompress, detectFormat, CompressionFormat } from './compression'

describe('compress', () => {
  test('compresses string data with gzip', async () => {
    const input = 'Hello, World!'
    const compressed = await compress(input, 'gzip')

    expect(compressed).toBeInstanceOf(Uint8Array)
    expect(compressed.length).toBeGreaterThan(0)
  })

  test('compresses Uint8Array data', async () => {
    const input = new TextEncoder().encode('Hello, World!')
    const compressed = await compress(input, 'gzip')

    expect(compressed).toBeInstanceOf(Uint8Array)
  })

  test('compresses with deflate', async () => {
    const input = 'Test data for deflate compression'
    const compressed = await compress(input, 'deflate')

    expect(compressed).toBeInstanceOf(Uint8Array)
    expect(compressed.length).toBeGreaterThan(0)
  })

  test('compresses repetitive data efficiently', async () => {
    const input = 'a'.repeat(1000)
    const compressed = await compress(input, 'gzip')

    // Highly repetitive data should compress well
    expect(compressed.length).toBeLessThan(input.length)
  })

  test('handles empty input', async () => {
    const compressed = await compress('', 'gzip')
    expect(compressed).toBeInstanceOf(Uint8Array)
  })

  test('defaults to gzip when no format specified', async () => {
    const input = 'Default format test'
    const compressed = await compress(input)

    // Should produce valid gzip output (magic bytes 0x1f, 0x8b)
    expect(compressed[0]).toBe(0x1f)
    expect(compressed[1]).toBe(0x8b)
  })
})

describe('decompress', () => {
  test('decompresses gzip data', async () => {
    const original = 'Hello, World!'
    const compressed = await compress(original, 'gzip')
    const decompressed = await decompress(compressed, 'gzip')

    const result = new TextDecoder().decode(decompressed)
    expect(result).toBe(original)
  })

  test('decompresses deflate data', async () => {
    const original = 'Deflate roundtrip test'
    const compressed = await compress(original, 'deflate')
    const decompressed = await decompress(compressed, 'deflate')

    const result = new TextDecoder().decode(decompressed)
    expect(result).toBe(original)
  })

  test('preserves binary data', async () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 253])
    const compressed = await compress(original, 'gzip')
    const decompressed = await decompress(compressed, 'gzip')

    expect(decompressed).toEqual(original)
  })

  test('handles empty compressed data', async () => {
    const compressed = await compress('', 'gzip')
    const decompressed = await decompress(compressed, 'gzip')

    expect(decompressed.length).toBe(0)
  })

  test('throws on invalid compressed data', async () => {
    const invalid = new Uint8Array([0x00, 0x01, 0x02, 0x03])

    await expect(decompress(invalid, 'gzip')).rejects.toThrow()
  })

  test('throws on truncated compressed data', async () => {
    const original = 'Test data'
    const compressed = await compress(original, 'gzip')
    const truncated = compressed.slice(0, compressed.length - 5)

    await expect(decompress(truncated, 'gzip')).rejects.toThrow()
  })
})

describe('compress/decompress roundtrip', () => {
  const formats: CompressionFormat[] = ['gzip', 'deflate', 'deflate-raw']

  for (const format of formats) {
    test(`roundtrips text data with ${format}`, async () => {
      const original = 'The quick brown fox jumps over the lazy dog.'
      const compressed = await compress(original, format)
      const decompressed = await decompress(compressed, format)

      const result = new TextDecoder().decode(decompressed)
      expect(result).toBe(original)
    })

    test(`roundtrips binary data with ${format}`, async () => {
      const original = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        original[i] = i
      }

      const compressed = await compress(original, format)
      const decompressed = await decompress(compressed, format)

      expect(decompressed).toEqual(original)
    })

    test(`roundtrips UTF-8 text with ${format}`, async () => {
      const original = 'Hello \u4e16\u754c \u{1F600}'
      const compressed = await compress(original, format)
      const decompressed = await decompress(compressed, format)

      const result = new TextDecoder().decode(decompressed)
      expect(result).toBe(original)
    })
  }

  test('roundtrips large data', async () => {
    const original = new Uint8Array(100000)
    for (let i = 0; i < original.length; i++) {
      original[i] = i % 256
    }

    const compressed = await compress(original, 'gzip')
    const decompressed = await decompress(compressed, 'gzip')

    expect(decompressed).toEqual(original)
  })
})

describe('detectFormat', () => {
  test('detects gzip format', async () => {
    const compressed = await compress('test', 'gzip')
    expect(detectFormat(compressed)).toBe('gzip')
  })

  test('detects deflate format', async () => {
    const compressed = await compress('test', 'deflate')
    expect(detectFormat(compressed)).toBe('deflate')
  })

  test('returns null for uncompressed data', () => {
    const plain = new TextEncoder().encode('plain text')
    expect(detectFormat(plain)).toBeNull()
  })

  test('returns null for empty data', () => {
    expect(detectFormat(new Uint8Array(0))).toBeNull()
  })

  test('returns null for short data', () => {
    expect(detectFormat(new Uint8Array([0x1f]))).toBeNull()
  })
})
