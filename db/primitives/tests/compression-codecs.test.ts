/**
 * Compression Codecs Input Validation Tests
 *
 * Tests for malformed input handling in compression codec decoders.
 * These tests verify that decoders gracefully handle:
 * - Empty buffers
 * - Truncated data
 * - Invalid headers
 * - Corrupt data
 *
 * @module db/primitives/tests/compression-codecs
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createColumnStore, TypedColumnStore } from '../typed-column-store'

describe('Compression Codec Input Validation', () => {
  let store: TypedColumnStore

  beforeEach(() => {
    store = createColumnStore()
  })

  // ============================================================================
  // Gorilla Codec Validation Tests
  // ============================================================================

  describe('Gorilla Codec', () => {
    describe('empty buffer handling', () => {
      it('should return empty array for zero-length buffer', () => {
        const data = new Uint8Array(0)
        const result = store.decode(data, 'gorilla')
        expect(result).toEqual([])
      })

      it('should throw for buffer smaller than header (1-3 bytes)', () => {
        expect(() => store.decode(new Uint8Array([0x01]), 'gorilla')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02]), 'gorilla')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02, 0x03]), 'gorilla')).toThrow('Buffer too small')
      })
    })

    describe('truncated data handling', () => {
      it('should throw for buffer with length > 0 but insufficient data for first value', () => {
        // Header says 1 value but no data for the value
        const data = new Uint8Array([0x01, 0x00, 0x00, 0x00]) // length = 1
        expect(() => store.decode(data, 'gorilla')).toThrow('truncated')
      })

      it('should throw for buffer with length > 0 but only partial first value', () => {
        // Header says 1 value but only 4 bytes after header (need 8)
        const data = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        expect(() => store.decode(data, 'gorilla')).toThrow('truncated')
      })
    })

    describe('invalid header handling', () => {
      it('should throw for unreasonably large length value', () => {
        // Set length to 200 million (0x0BEBC200)
        const data = new Uint8Array(16)
        const view = new DataView(data.buffer)
        view.setUint32(0, 200_000_000, true)
        expect(() => store.decode(data, 'gorilla')).toThrow('exceeds maximum')
      })

      it('should return empty array for length = 0', () => {
        const data = new Uint8Array([0x00, 0x00, 0x00, 0x00])
        const result = store.decode(data, 'gorilla')
        expect(result).toEqual([])
      })
    })

    describe('corrupt data handling', () => {
      it('should handle corrupt data gracefully without crashing', () => {
        // Valid header with length=2, but garbage data
        const data = new Uint8Array(20)
        const view = new DataView(data.buffer)
        view.setUint32(0, 2, true)
        // Fill with random garbage
        for (let i = 4; i < 20; i++) {
          data[i] = Math.floor(Math.random() * 256)
        }

        // Should either decode (with possibly wrong values) or throw - but not crash
        expect(() => {
          store.decode(data, 'gorilla')
        }).not.toThrow(/Maximum call stack|out of memory/i)
      })
    })

    describe('round-trip still works after validation added', () => {
      it('should correctly encode and decode valid data', () => {
        const input = [1.0, 2.0, 3.0, 4.0, 5.0]
        const encoded = store.encode(input, 'gorilla')
        const decoded = store.decode(encoded, 'gorilla')
        expect(decoded).toEqual(input)
      })

      it('should handle edge cases like empty array', () => {
        const input: number[] = []
        const encoded = store.encode(input, 'gorilla')
        const decoded = store.decode(encoded, 'gorilla')
        expect(decoded).toEqual([])
      })

      it('should handle single value', () => {
        const input = [42.5]
        const encoded = store.encode(input, 'gorilla')
        const decoded = store.decode(encoded, 'gorilla')
        expect(decoded).toEqual([42.5])
      })
    })
  })

  // ============================================================================
  // Delta Codec Validation Tests
  // ============================================================================

  describe('Delta Codec', () => {
    describe('empty buffer handling', () => {
      it('should return empty array for zero-length buffer', () => {
        const data = new Uint8Array(0)
        const result = store.decode(data, 'delta')
        expect(result).toEqual([])
      })

      it('should throw for buffer smaller than header (1-3 bytes)', () => {
        expect(() => store.decode(new Uint8Array([0x01]), 'delta')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02]), 'delta')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02, 0x03]), 'delta')).toThrow('Buffer too small')
      })
    })

    describe('truncated data handling', () => {
      it('should throw for buffer with length > 0 but insufficient data for first value', () => {
        // Header says 1 value but no first value data (need 12 bytes total: 4 header + 8 value)
        const data = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        expect(() => store.decode(data, 'delta')).toThrow('truncated')
      })
    })

    describe('invalid header handling', () => {
      it('should throw for unreasonably large length value', () => {
        const data = new Uint8Array(16)
        const view = new DataView(data.buffer)
        view.setUint32(0, 200_000_000, true)
        expect(() => store.decode(data, 'delta')).toThrow('exceeds maximum')
      })

      it('should return empty array for length = 0', () => {
        const data = new Uint8Array([0x00, 0x00, 0x00, 0x00])
        const result = store.decode(data, 'delta')
        expect(result).toEqual([])
      })
    })

    describe('round-trip still works after validation added', () => {
      it('should correctly encode and decode valid data', () => {
        const input = [1000, 2000, 3000, 4000, 5000]
        const encoded = store.encode(input, 'delta')
        const decoded = store.decode(encoded, 'delta')
        expect(decoded).toEqual(input)
      })

      it('should handle empty array', () => {
        const input: number[] = []
        const encoded = store.encode(input, 'delta')
        const decoded = store.decode(encoded, 'delta')
        expect(decoded).toEqual([])
      })

      it('should handle single value', () => {
        const input = [1736438400000]
        const encoded = store.encode(input, 'delta')
        const decoded = store.decode(encoded, 'delta')
        expect(decoded).toEqual([1736438400000])
      })
    })
  })

  // ============================================================================
  // RLE Codec Validation Tests
  // ============================================================================

  describe('RLE Codec', () => {
    describe('empty buffer handling', () => {
      it('should return empty array for zero-length buffer', () => {
        const data = new Uint8Array(0)
        const result = store.decode(data, 'rle')
        expect(result).toEqual([])
      })

      it('should throw for buffer smaller than header (1-3 bytes)', () => {
        expect(() => store.decode(new Uint8Array([0x01]), 'rle')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02]), 'rle')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02, 0x03]), 'rle')).toThrow('Buffer too small')
      })
    })

    describe('truncated data handling', () => {
      it('should throw for buffer with length > 0 but insufficient data for run count', () => {
        // Header says original length = 5 but not enough bytes for numRuns
        const data = new Uint8Array([0x05, 0x00, 0x00, 0x00])
        expect(() => store.decode(data, 'rle')).toThrow('truncated')
      })

      it('should throw for buffer claiming more runs than available data', () => {
        // Header: originalLength=5, numRuns=2, but only space for 1 run
        const data = new Uint8Array(20) // 8 header + 12 for one run
        const view = new DataView(data.buffer)
        view.setUint32(0, 5, true) // originalLength
        view.setUint32(4, 2, true) // numRuns (claims 2, but only data for 1)
        view.setFloat64(8, 42.0, true)
        view.setUint32(16, 5, true)

        expect(() => store.decode(data, 'rle')).toThrow('truncated')
      })
    })

    describe('invalid header handling', () => {
      it('should throw for unreasonably large original length', () => {
        const data = new Uint8Array(16)
        const view = new DataView(data.buffer)
        view.setUint32(0, 200_000_000, true) // originalLength
        view.setUint32(4, 1, true) // numRuns
        expect(() => store.decode(data, 'rle')).toThrow('exceeds maximum')
      })

      it('should throw for unreasonably large number of runs', () => {
        const data = new Uint8Array(16)
        const view = new DataView(data.buffer)
        view.setUint32(0, 100, true) // originalLength
        view.setUint32(4, 200_000_000, true) // numRuns
        expect(() => store.decode(data, 'rle')).toThrow('exceeds maximum')
      })

      it('should return empty array for originalLength = 0', () => {
        const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        const result = store.decode(data, 'rle')
        expect(result).toEqual([])
      })
    })

    describe('corrupt data handling', () => {
      it('should throw when run counts exceed declared original length', () => {
        // Create valid structure but with run count that exceeds originalLength
        const data = new Uint8Array(20)
        const view = new DataView(data.buffer)
        view.setUint32(0, 5, true) // originalLength = 5
        view.setUint32(4, 1, true) // numRuns = 1
        view.setFloat64(8, 42.0, true) // value
        view.setUint32(16, 100, true) // count = 100 (exceeds originalLength of 5)

        expect(() => store.decode(data, 'rle')).toThrow('exceeds declared original length')
      })

      it('should throw for unreasonably large individual run count', () => {
        const data = new Uint8Array(20)
        const view = new DataView(data.buffer)
        view.setUint32(0, 200_000_000, true) // originalLength (large but within limit)
        view.setUint32(4, 1, true) // numRuns
        view.setFloat64(8, 42.0, true)
        view.setUint32(16, 200_000_000, true) // count too large

        expect(() => store.decode(data, 'rle')).toThrow('exceeds maximum')
      })
    })

    describe('round-trip still works after validation added', () => {
      it('should correctly encode and decode valid data', () => {
        const input = [1, 1, 1, 2, 2, 3, 3, 3, 3]
        const encoded = store.encode(input, 'rle')
        const decoded = store.decode(encoded, 'rle')
        expect(decoded).toEqual(input)
      })

      it('should handle empty array', () => {
        const input: number[] = []
        const encoded = store.encode(input, 'rle')
        const decoded = store.decode(encoded, 'rle')
        expect(decoded).toEqual([])
      })

      it('should handle single value', () => {
        const input = [42]
        const encoded = store.encode(input, 'rle')
        const decoded = store.decode(encoded, 'rle')
        expect(decoded).toEqual([42])
      })
    })
  })

  // ============================================================================
  // ZSTD Codec Validation Tests
  // ============================================================================

  describe('ZSTD Codec', () => {
    describe('empty buffer handling', () => {
      it('should return empty array for zero-length buffer', () => {
        const data = new Uint8Array(0)
        const result = store.decode(data, 'zstd')
        expect(result).toEqual([])
      })

      it('should throw for buffer smaller than 4 bytes (1-3 bytes)', () => {
        expect(() => store.decode(new Uint8Array([0x01]), 'zstd')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02]), 'zstd')).toThrow('Buffer too small')
        expect(() => store.decode(new Uint8Array([0x01, 0x02, 0x03]), 'zstd')).toThrow('Buffer too small')
      })

      it('should throw for non-empty length but missing compressed length field (4-7 bytes)', () => {
        // 4 bytes with length=1 (non-zero) should fail - needs 8 bytes minimum for full header
        const data = new Uint8Array([0x01, 0x00, 0x00, 0x00]) // length = 1
        expect(() => store.decode(data, 'zstd')).toThrow('truncated')

        const data2 = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) // 7 bytes, length = 1
        expect(() => store.decode(data2, 'zstd')).toThrow('truncated')
      })
    })

    describe('truncated data handling', () => {
      it('should throw when compressed length exceeds available data', () => {
        const data = new Uint8Array(12)
        const view = new DataView(data.buffer)
        view.setUint32(0, 1, true) // length = 1
        view.setUint32(4, 100, true) // compressedLength = 100 (but only 4 bytes available)

        expect(() => store.decode(data, 'zstd')).toThrow('truncated')
      })
    })

    describe('invalid header handling', () => {
      it('should throw for unreasonably large length value', () => {
        const data = new Uint8Array(16)
        const view = new DataView(data.buffer)
        view.setUint32(0, 200_000_000, true) // length
        view.setUint32(4, 8, true) // compressedLength
        expect(() => store.decode(data, 'zstd')).toThrow('exceeds maximum')
      })

      it('should throw for unreasonably large compressed length', () => {
        const data = new Uint8Array(16)
        const view = new DataView(data.buffer)
        view.setUint32(0, 1, true) // length
        view.setUint32(4, 2_000_000_000, true) // compressedLength too large
        expect(() => store.decode(data, 'zstd')).toThrow(/exceeds|truncated/)
      })

      it('should return empty array for length = 0', () => {
        const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        const result = store.decode(data, 'zstd')
        expect(result).toEqual([])
      })
    })

    describe('corrupt data handling', () => {
      it('should handle corrupt but decodable data without crashing', () => {
        // The ZSTD codec uses a simple RLE-like compression that will always
        // produce some output. This test verifies it doesn't crash on garbage input.
        const data = new Uint8Array(24)
        const view = new DataView(data.buffer)
        view.setUint32(0, 2, true) // claims 2 values (16 bytes decompressed)
        view.setUint32(4, 16, true) // 16 bytes of "compressed" data

        // Fill with random garbage
        for (let i = 8; i < 24; i++) {
          data[i] = Math.floor(Math.random() * 256)
        }

        // Should not crash - may return wrong values but shouldn't throw
        expect(() => store.decode(data, 'zstd')).not.toThrow()
      })

      it('should throw when claimed compressed length is inconsistent with data', () => {
        // Create data that claims more compressed bytes than available
        const data = new Uint8Array(12)
        const view = new DataView(data.buffer)
        view.setUint32(0, 5, true) // claims 5 values
        view.setUint32(4, 100, true) // claims 100 bytes compressed but only 4 available

        expect(() => store.decode(data, 'zstd')).toThrow('truncated')
      })
    })

    describe('round-trip still works after validation added', () => {
      it('should correctly encode and decode valid data', () => {
        const input = [1.5, 2.5, 3.5, 4.5, 5.5]
        const encoded = store.encode(input, 'zstd')
        const decoded = store.decode(encoded, 'zstd')
        expect(decoded).toEqual(input)
      })

      it('should handle empty array', () => {
        const input: number[] = []
        const encoded = store.encode(input, 'zstd')
        const decoded = store.decode(encoded, 'zstd')
        expect(decoded).toEqual([])
      })

      it('should handle repetitive data', () => {
        const input = Array(100).fill(42)
        const encoded = store.encode(input, 'zstd')
        const decoded = store.decode(encoded, 'zstd')
        expect(decoded).toEqual(input)
      })
    })
  })

  // ============================================================================
  // Cross-Codec Tests
  // ============================================================================

  describe('Unknown Codec Handling', () => {
    it('should throw for unknown codec name', () => {
      const data = new Uint8Array(16)
      expect(() => store.decode(data, 'unknown')).toThrow('Unknown codec')
      expect(() => store.decode(data, 'lz4')).toThrow('Unknown codec')
      expect(() => store.decode(data, '')).toThrow('Unknown codec')
    })
  })

  describe('All Codecs Handle Boundary Cases Consistently', () => {
    const codecs = ['gorilla', 'delta', 'rle', 'zstd'] as const

    it('should all return empty array for zero-length buffer', () => {
      const data = new Uint8Array(0)
      for (const codec of codecs) {
        expect(store.decode(data, codec)).toEqual([])
      }
    })

    it('should all handle encode/decode of empty array', () => {
      const input: number[] = []
      for (const codec of codecs) {
        const encoded = store.encode(input, codec)
        const decoded = store.decode(encoded, codec)
        expect(decoded).toEqual([])
      }
    })

    it('should all handle encode/decode of single value', () => {
      const input = [42]
      for (const codec of codecs) {
        const encoded = store.encode(input, codec)
        const decoded = store.decode(encoded, codec)
        expect(decoded).toEqual(input)
      }
    })

    it('should all handle encode/decode of multiple values', () => {
      const input = [1, 2, 3, 4, 5]
      for (const codec of codecs) {
        const encoded = store.encode(input, codec)
        const decoded = store.decode(encoded, codec)
        expect(decoded).toEqual(input)
      }
    })
  })
})
