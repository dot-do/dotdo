/**
 * Core Posting List Operations Tests (RED Phase)
 *
 * Tests for posting list data structure that stores document IDs
 * for inverted index operations. Uses Roaring bitmaps for efficient
 * storage and set operations.
 *
 * @module db/primitives/inverted-index/tests/posting-list
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PostingList,
  PostingListWithTF,
  encodeVarint,
  decodeVarint,
  varintSize,
} from '../posting-list'

describe('PostingList', () => {
  // ============================================================================
  // Basic Operations
  // ============================================================================

  describe('add and contains', () => {
    it('should add a single document ID', () => {
      const list = new PostingList()
      list.add(1)
      expect(list.contains(1)).toBe(true)
    })

    it('should not contain document IDs that were not added', () => {
      const list = new PostingList()
      list.add(1)
      expect(list.contains(2)).toBe(false)
      expect(list.contains(0)).toBe(false)
    })

    it('should add multiple document IDs', () => {
      const list = new PostingList()
      list.add(1)
      list.add(5)
      list.add(10)
      expect(list.contains(1)).toBe(true)
      expect(list.contains(5)).toBe(true)
      expect(list.contains(10)).toBe(true)
    })

    it('should handle duplicate adds idempotently', () => {
      const list = new PostingList()
      list.add(5)
      list.add(5)
      list.add(5)
      expect(list.cardinality).toBe(1)
      expect(list.contains(5)).toBe(true)
    })

    it('should handle large document IDs', () => {
      const list = new PostingList()
      list.add(1_000_000)
      list.add(10_000_000)
      expect(list.contains(1_000_000)).toBe(true)
      expect(list.contains(10_000_000)).toBe(true)
    })

    it('should handle document ID 0', () => {
      const list = new PostingList()
      list.add(0)
      expect(list.contains(0)).toBe(true)
    })
  })

  describe('cardinality', () => {
    it('should return 0 for empty list', () => {
      const list = new PostingList()
      expect(list.cardinality).toBe(0)
    })

    it('should return correct count after adds', () => {
      const list = new PostingList()
      list.add(1)
      expect(list.cardinality).toBe(1)
      list.add(2)
      expect(list.cardinality).toBe(2)
      list.add(3)
      expect(list.cardinality).toBe(3)
    })

    it('should not increase for duplicate adds', () => {
      const list = new PostingList()
      list.add(1)
      list.add(1)
      expect(list.cardinality).toBe(1)
    })

    it('should handle thousands of document IDs', () => {
      const list = new PostingList()
      for (let i = 0; i < 5000; i++) {
        list.add(i * 2) // Add even numbers
      }
      expect(list.cardinality).toBe(5000)
    })
  })

  describe('toArray', () => {
    it('should return empty array for empty list', () => {
      const list = new PostingList()
      expect(list.toArray()).toEqual([])
    })

    it('should return sorted document IDs', () => {
      const list = new PostingList()
      list.add(10)
      list.add(1)
      list.add(5)
      expect(list.toArray()).toEqual([1, 5, 10])
    })

    it('should handle document IDs added in order', () => {
      const list = new PostingList()
      list.add(1)
      list.add(2)
      list.add(3)
      expect(list.toArray()).toEqual([1, 2, 3])
    })

    it('should handle document IDs added in reverse order', () => {
      const list = new PostingList()
      list.add(3)
      list.add(2)
      list.add(1)
      expect(list.toArray()).toEqual([1, 2, 3])
    })

    it('should handle sparse document IDs', () => {
      const list = new PostingList()
      list.add(100)
      list.add(1000)
      list.add(10000)
      expect(list.toArray()).toEqual([100, 1000, 10000])
    })
  })

  // ============================================================================
  // Serialization
  // ============================================================================

  describe('serialize and deserialize', () => {
    it('should round-trip empty list', () => {
      const original = new PostingList()
      const bytes = original.serialize()
      const restored = PostingList.deserialize(bytes)
      expect(restored.cardinality).toBe(0)
      expect(restored.toArray()).toEqual([])
    })

    it('should round-trip single document ID', () => {
      const original = new PostingList()
      original.add(42)
      const bytes = original.serialize()
      const restored = PostingList.deserialize(bytes)
      expect(restored.contains(42)).toBe(true)
      expect(restored.cardinality).toBe(1)
    })

    it('should round-trip multiple document IDs', () => {
      const original = new PostingList()
      original.add(1)
      original.add(10)
      original.add(100)
      const bytes = original.serialize()
      const restored = PostingList.deserialize(bytes)
      expect(restored.toArray()).toEqual([1, 10, 100])
    })

    it('should round-trip large document IDs', () => {
      const original = new PostingList()
      original.add(1_000_000)
      original.add(2_000_000)
      const bytes = original.serialize()
      const restored = PostingList.deserialize(bytes)
      expect(restored.toArray()).toEqual([1_000_000, 2_000_000])
    })

    it('should handle thousands of document IDs', () => {
      const original = new PostingList()
      const expected: number[] = []
      for (let i = 0; i < 1000; i++) {
        original.add(i)
        expected.push(i)
      }
      const bytes = original.serialize()
      const restored = PostingList.deserialize(bytes)
      expect(restored.toArray()).toEqual(expected)
    })
  })

  // ============================================================================
  // Roaring Bitmap Container Switching
  // ============================================================================

  describe('container switching', () => {
    it('should use array container for sparse sets (< 4096 per 64K range)', () => {
      const list = new PostingList()
      // Add a few values in the same 64K range
      for (let i = 0; i < 100; i++) {
        list.add(i)
      }
      // Internal implementation detail: should use ArrayContainer
      expect(list.cardinality).toBe(100)
      expect(list.getContainerType(0)).toBe('array')
    })

    it('should switch to bitmap container for dense sets (>= 4096 per 64K range)', () => {
      const list = new PostingList()
      // Add enough values to trigger bitmap conversion
      for (let i = 0; i < 5000; i++) {
        list.add(i)
      }
      expect(list.cardinality).toBe(5000)
      expect(list.getContainerType(0)).toBe('bitmap')
    })

    it('should handle multiple containers for different 64K ranges', () => {
      const list = new PostingList()
      // Add to first container (0-65535)
      list.add(0)
      list.add(100)
      // Add to second container (65536-131071)
      list.add(70000)
      list.add(70001)

      expect(list.contains(0)).toBe(true)
      expect(list.contains(100)).toBe(true)
      expect(list.contains(70000)).toBe(true)
      expect(list.contains(70001)).toBe(true)
      expect(list.cardinality).toBe(4)
    })

    it('should serialize and deserialize mixed containers correctly', () => {
      const original = new PostingList()
      // Sparse container
      for (let i = 0; i < 100; i++) {
        original.add(i)
      }
      // Dense container (different 64K range)
      for (let i = 65536; i < 70536; i++) {
        original.add(i)
      }

      const bytes = original.serialize()
      const restored = PostingList.deserialize(bytes)

      expect(restored.cardinality).toBe(5100)
      expect(restored.contains(0)).toBe(true)
      expect(restored.contains(99)).toBe(true)
      expect(restored.contains(65536)).toBe(true)
      expect(restored.contains(70535)).toBe(true)
    })
  })
})

// ============================================================================
// PostingList with Term Frequencies
// ============================================================================

describe('PostingListWithTF', () => {
  describe('add with term frequency', () => {
    it('should store term frequency for document', () => {
      const list = new PostingListWithTF()
      list.add(1, 5) // doc 1 has tf=5
      expect(list.getTf(1)).toBe(5)
    })

    it('should return 0 tf for non-existent document', () => {
      const list = new PostingListWithTF()
      expect(list.getTf(999)).toBe(0)
    })

    it('should update term frequency on re-add', () => {
      const list = new PostingListWithTF()
      list.add(1, 3)
      list.add(1, 7)
      expect(list.getTf(1)).toBe(7)
    })

    it('should store multiple documents with different TFs', () => {
      const list = new PostingListWithTF()
      list.add(1, 3)
      list.add(2, 5)
      list.add(3, 1)
      expect(list.getTf(1)).toBe(3)
      expect(list.getTf(2)).toBe(5)
      expect(list.getTf(3)).toBe(1)
    })
  })

  describe('serialize and deserialize with TF', () => {
    it('should round-trip empty list', () => {
      const original = new PostingListWithTF()
      const bytes = original.serialize()
      const restored = PostingListWithTF.deserialize(bytes)
      expect(restored.cardinality).toBe(0)
    })

    it('should round-trip single posting', () => {
      const original = new PostingListWithTF()
      original.add(42, 7)
      const bytes = original.serialize()
      const restored = PostingListWithTF.deserialize(bytes)
      expect(restored.contains(42)).toBe(true)
      expect(restored.getTf(42)).toBe(7)
    })

    it('should round-trip multiple postings with delta encoding', () => {
      const original = new PostingListWithTF()
      original.add(10, 1)
      original.add(20, 2)
      original.add(30, 3)
      const bytes = original.serialize()
      const restored = PostingListWithTF.deserialize(bytes)
      expect(restored.getTf(10)).toBe(1)
      expect(restored.getTf(20)).toBe(2)
      expect(restored.getTf(30)).toBe(3)
    })

    it('should handle large TF values', () => {
      const original = new PostingListWithTF()
      original.add(1, 1000)
      original.add(2, 5000)
      const bytes = original.serialize()
      const restored = PostingListWithTF.deserialize(bytes)
      expect(restored.getTf(1)).toBe(1000)
      expect(restored.getTf(2)).toBe(5000)
    })
  })

  describe('getPostings', () => {
    it('should return all postings sorted by docId', () => {
      const list = new PostingListWithTF()
      list.add(30, 3)
      list.add(10, 1)
      list.add(20, 2)
      const postings = list.getPostings()
      expect(postings).toEqual([
        { docId: 10, tf: 1 },
        { docId: 20, tf: 2 },
        { docId: 30, tf: 3 },
      ])
    })

    it('should return empty array for empty list', () => {
      const list = new PostingListWithTF()
      expect(list.getPostings()).toEqual([])
    })
  })
})

// ============================================================================
// Varint Encoding
// ============================================================================

describe('Varint Encoding', () => {
  describe('encodeVarint', () => {
    it('should encode 0', () => {
      const bytes = encodeVarint(0)
      expect(bytes.length).toBe(1)
      expect(bytes[0]).toBe(0)
    })

    it('should encode small values (< 128)', () => {
      expect(encodeVarint(1)).toEqual(new Uint8Array([1]))
      expect(encodeVarint(127)).toEqual(new Uint8Array([127]))
    })

    it('should encode medium values (128-16383)', () => {
      const bytes = encodeVarint(128)
      expect(bytes.length).toBe(2)
      expect(encodeVarint(16383).length).toBe(2)
    })

    it('should encode large values', () => {
      const bytes = encodeVarint(1_000_000)
      expect(bytes.length).toBeLessThanOrEqual(4)
    })

    it('should throw for negative values', () => {
      expect(() => encodeVarint(-1)).toThrow()
    })
  })

  describe('decodeVarint', () => {
    it('should decode 0', () => {
      const [value, bytesRead] = decodeVarint(new Uint8Array([0]), 0)
      expect(value).toBe(0)
      expect(bytesRead).toBe(1)
    })

    it('should decode small values', () => {
      const [value, bytesRead] = decodeVarint(new Uint8Array([127]), 0)
      expect(value).toBe(127)
      expect(bytesRead).toBe(1)
    })

    it('should decode medium values', () => {
      const encoded = encodeVarint(300)
      const [value, bytesRead] = decodeVarint(encoded, 0)
      expect(value).toBe(300)
    })

    it('should decode at offset', () => {
      const buffer = new Uint8Array([0xff, 0xff, 42, 0xff])
      const [value, bytesRead] = decodeVarint(buffer, 2)
      expect(value).toBe(42)
      expect(bytesRead).toBe(1)
    })
  })

  describe('varintSize', () => {
    it('should return 1 for values < 128', () => {
      expect(varintSize(0)).toBe(1)
      expect(varintSize(127)).toBe(1)
    })

    it('should return 2 for values 128-16383', () => {
      expect(varintSize(128)).toBe(2)
      expect(varintSize(16383)).toBe(2)
    })

    it('should return correct sizes for larger values', () => {
      expect(varintSize(16384)).toBe(3)
      expect(varintSize(2097151)).toBe(3)
      expect(varintSize(2097152)).toBe(4)
    })
  })

  describe('round-trip encoding', () => {
    it('should round-trip various values', () => {
      const testValues = [0, 1, 127, 128, 255, 256, 1000, 10000, 100000, 1000000]
      for (const original of testValues) {
        const encoded = encodeVarint(original)
        const [decoded] = decodeVarint(encoded, 0)
        expect(decoded).toBe(original)
      }
    })
  })
})

// ============================================================================
// Delta Encoding for Doc IDs
// ============================================================================

describe('Delta Encoding', () => {
  describe('delta encode/decode postings', () => {
    it('should compress sequential doc IDs efficiently', () => {
      const list = new PostingListWithTF()
      // Sequential IDs: 1, 2, 3, 4, 5
      // Deltas: 1, 1, 1, 1, 1 (all small varints)
      for (let i = 1; i <= 5; i++) {
        list.add(i, 1)
      }
      const bytes = list.serialize()
      // Sequential deltas should compress well
      expect(bytes.length).toBeLessThan(50)
    })

    it('should handle large gaps between doc IDs', () => {
      const list = new PostingListWithTF()
      list.add(1, 1)
      list.add(1000000, 1)
      const bytes = list.serialize()
      const restored = PostingListWithTF.deserialize(bytes)
      expect(restored.contains(1)).toBe(true)
      expect(restored.contains(1000000)).toBe(true)
    })

    it('should preserve order after delta decode', () => {
      const list = new PostingListWithTF()
      list.add(100, 1)
      list.add(50, 2)
      list.add(150, 3)
      const bytes = list.serialize()
      const restored = PostingListWithTF.deserialize(bytes)
      const docIds = restored.getPostings().map((p) => p.docId)
      expect(docIds).toEqual([50, 100, 150])
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty serialization gracefully', () => {
    const emptyBytes = new Uint8Array(0)
    const restored = PostingList.deserialize(emptyBytes)
    expect(restored.cardinality).toBe(0)
  })

  it('should throw for corrupted data', () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff])
    expect(() => PostingList.deserialize(garbage)).toThrow()
  })

  it('should handle max safe integer doc IDs', () => {
    const list = new PostingList()
    // Use a large but reasonable doc ID
    const largeId = 2 ** 30
    list.add(largeId)
    expect(list.contains(largeId)).toBe(true)
  })
})
