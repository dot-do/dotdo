/**
 * Cluster File Format Parser Tests
 *
 * Tests for the CLST binary format that stores PQ codes and vector IDs per cluster.
 * Part of the Static Assets Vector Search architecture.
 *
 * CLST File Format:
 * - Header (64 bytes): magic, version, flags, cluster_id, vector_count, M, id_type, has_metadata
 * - Vector IDs section: uint64 array or string offsets + string data
 * - PQ Codes section: interleaved uint8[M] per vector
 * - Metadata section (optional): compressed JSON/MessagePack
 *
 * @see docs/plans/static-assets-vector-search.md for full format specification
 * @module tests/vector/cluster-file.test
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

// These imports will fail until the module is implemented
// This is the expected behavior for TDD - tests define the API contract
let ClusterFile: any
let ClusterFileParser: any
let ClusterFileIterator: any
let parseClusterHeader: any
let parseClusterFile: any
let validateClusterChecksum: any
let createClusterFile: any

// Attempt to load the module - will fail until implemented
beforeEach(async () => {
  try {
    const clusterModule = await import('../../db/edgevec/cluster-file')
    ClusterFile = clusterModule.ClusterFile
    ClusterFileParser = clusterModule.ClusterFileParser
    ClusterFileIterator = clusterModule.ClusterFileIterator
    parseClusterHeader = clusterModule.parseClusterHeader
    parseClusterFile = clusterModule.parseClusterFile
    validateClusterChecksum = clusterModule.validateClusterChecksum
    createClusterFile = clusterModule.createClusterFile
  } catch {
    // Module not yet implemented - tests will fail with clear message
    ClusterFile = undefined
    ClusterFileParser = undefined
    ClusterFileIterator = undefined
    parseClusterHeader = undefined
    parseClusterFile = undefined
    validateClusterChecksum = undefined
    createClusterFile = undefined
  }
})

// ============================================================================
// CONSTANTS
// ============================================================================

/** CLST magic number: 0x434C5354 ("CLST") */
const CLST_MAGIC = 0x434c5354

/** Header size in bytes */
const HEADER_SIZE = 64

/** ID type: uint64 */
const ID_TYPE_UINT64 = 0

/** ID type: string with offset table */
const ID_TYPE_STRING = 1

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Helper to assert module is loaded
 */
function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `Cluster file module not implemented. Expected '${fnName}' from 'db/edgevec/cluster-file'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Creates a mock CLST header buffer
 */
function createMockHeader(options: {
  magic?: number
  version?: number
  flags?: number
  clusterId?: number
  vectorCount?: number
  M?: number
  idType?: number
  hasMetadata?: number
}): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE)
  const view = new DataView(buffer)

  // Header fields (little-endian by default in CLST format)
  view.setUint32(0, options.magic ?? CLST_MAGIC, true) // magic
  view.setUint16(4, options.version ?? 1, true) // version
  view.setUint16(6, options.flags ?? 0, true) // flags
  view.setUint32(8, options.clusterId ?? 0, true) // cluster_id
  view.setUint32(12, options.vectorCount ?? 0, true) // vector_count
  view.setUint8(16, options.M ?? 8) // M (subspaces)
  view.setUint8(17, options.idType ?? ID_TYPE_UINT64) // id_type
  view.setUint8(18, options.hasMetadata ?? 0) // has_metadata
  // Bytes 19-63 are reserved (zeros)

  return buffer
}

/**
 * Creates a complete mock CLST file with uint64 IDs
 */
function createMockClusterFileUint64(options: {
  clusterId?: number
  vectorCount: number
  M: number
  hasMetadata?: boolean
  ids?: bigint[]
  pqCodes?: Uint8Array[]
  metadata?: Record<string, unknown>[]
}): ArrayBuffer {
  const { clusterId = 0, vectorCount, M, hasMetadata = false, ids, pqCodes, metadata } = options

  // Calculate sizes
  const idsSectionSize = vectorCount * 8 // uint64 per vector
  const pqCodesSectionSize = vectorCount * M // uint8[M] per vector
  let metadataSectionSize = 0

  // For simplicity, metadata is stored as uncompressed JSON for mock data
  let metadataBuffer: Uint8Array | null = null
  if (hasMetadata && metadata) {
    const metadataJson = JSON.stringify(metadata)
    metadataBuffer = new TextEncoder().encode(metadataJson)
    // offset table: (vectorCount + 1) * 4 bytes + data
    metadataSectionSize = (vectorCount + 1) * 4 + metadataBuffer.length
  }

  const totalSize = HEADER_SIZE + idsSectionSize + pqCodesSectionSize + metadataSectionSize
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  // Write header
  view.setUint32(0, CLST_MAGIC, true)
  view.setUint16(4, 1, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, clusterId, true)
  view.setUint32(12, vectorCount, true)
  view.setUint8(16, M)
  view.setUint8(17, ID_TYPE_UINT64)
  view.setUint8(18, hasMetadata ? 1 : 0)

  // Write IDs section
  let offset = HEADER_SIZE
  for (let i = 0; i < vectorCount; i++) {
    const id = ids ? ids[i] : BigInt(i + 1)
    view.setBigUint64(offset, id, true)
    offset += 8
  }

  // Write PQ codes section
  for (let i = 0; i < vectorCount; i++) {
    const codes = pqCodes ? pqCodes[i] : new Uint8Array(M).fill(i % 256)
    uint8View.set(codes, offset)
    offset += M
  }

  // Write metadata section (simplified - offsets + raw JSON data)
  if (hasMetadata && metadataBuffer) {
    // Write offset table (simplified: evenly distributed offsets for mock)
    const perVectorSize = Math.floor(metadataBuffer.length / vectorCount)
    for (let i = 0; i <= vectorCount; i++) {
      view.setUint32(offset, i * perVectorSize, true)
      offset += 4
    }
    // Write metadata data
    uint8View.set(metadataBuffer, offset)
  }

  return buffer
}

/**
 * Creates a mock CLST file with string IDs
 */
function createMockClusterFileStringIds(options: {
  clusterId?: number
  M: number
  ids: string[]
  pqCodes?: Uint8Array[]
}): ArrayBuffer {
  const { clusterId = 0, M, ids, pqCodes } = options
  const vectorCount = ids.length

  // Build string table
  const encoder = new TextEncoder()
  const stringBuffers = ids.map((id) => encoder.encode(id))
  const stringTableSize = stringBuffers.reduce((sum, buf) => sum + buf.length, 0)

  // offset table: (vectorCount + 1) * 4 bytes
  const offsetTableSize = (vectorCount + 1) * 4
  const idsSectionSize = offsetTableSize + stringTableSize
  const pqCodesSectionSize = vectorCount * M

  const totalSize = HEADER_SIZE + idsSectionSize + pqCodesSectionSize
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  // Write header
  view.setUint32(0, CLST_MAGIC, true)
  view.setUint16(4, 1, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, clusterId, true)
  view.setUint32(12, vectorCount, true)
  view.setUint8(16, M)
  view.setUint8(17, ID_TYPE_STRING)
  view.setUint8(18, 0) // no metadata

  // Write string offsets
  let offset = HEADER_SIZE
  let stringOffset = 0
  for (let i = 0; i <= vectorCount; i++) {
    view.setUint32(offset, stringOffset, true)
    offset += 4
    if (i < vectorCount) {
      stringOffset += stringBuffers[i].length
    }
  }

  // Write string data
  for (let i = 0; i < vectorCount; i++) {
    uint8View.set(stringBuffers[i], offset)
    offset += stringBuffers[i].length
  }

  // Write PQ codes section
  for (let i = 0; i < vectorCount; i++) {
    const codes = pqCodes ? pqCodes[i] : new Uint8Array(M).fill(i % 256)
    uint8View.set(codes, offset)
    offset += M
  }

  return buffer
}

/**
 * Creates a large mock cluster file for performance testing
 */
function createLargeMockClusterFile(vectorCount: number, M: number): ArrayBuffer {
  // Use a simple pattern to create large file without storing full arrays
  const idsSectionSize = vectorCount * 8
  const pqCodesSectionSize = vectorCount * M
  const totalSize = HEADER_SIZE + idsSectionSize + pqCodesSectionSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  // Write header
  view.setUint32(0, CLST_MAGIC, true)
  view.setUint16(4, 1, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, 0, true) // cluster 0
  view.setUint32(12, vectorCount, true)
  view.setUint8(16, M)
  view.setUint8(17, ID_TYPE_UINT64)
  view.setUint8(18, 0)

  // Write IDs (sequential for simplicity)
  let offset = HEADER_SIZE
  for (let i = 0; i < vectorCount; i++) {
    view.setBigUint64(offset, BigInt(i + 1), true)
    offset += 8
  }

  // Write PQ codes (simple pattern)
  for (let i = 0; i < vectorCount; i++) {
    for (let m = 0; m < M; m++) {
      uint8View[offset++] = (i + m) % 256
    }
  }

  return buffer
}

/**
 * Creates a mock cluster file with checksum
 */
function createMockClusterFileWithChecksum(vectorCount: number, M: number): ArrayBuffer {
  // Create base file
  const baseBuffer = createMockClusterFileUint64({ vectorCount, M })

  // Add 4-byte CRC32 checksum at end
  const totalSize = baseBuffer.byteLength + 4
  const buffer = new ArrayBuffer(totalSize)
  const uint8View = new Uint8Array(buffer)

  // Copy base data
  uint8View.set(new Uint8Array(baseBuffer), 0)

  // Set flags to indicate checksum presence
  const view = new DataView(buffer)
  view.setUint16(6, 0x0001, true) // flags: bit 0 = has checksum

  // Calculate simple checksum (CRC32 placeholder - just XOR for mock)
  let checksum = 0
  for (let i = 0; i < baseBuffer.byteLength; i++) {
    checksum ^= uint8View[i]
    checksum = ((checksum << 1) | (checksum >>> 31)) >>> 0 // rotate left
  }
  view.setUint32(baseBuffer.byteLength, checksum, true)

  return buffer
}

// ============================================================================
// HEADER PARSING TESTS
// ============================================================================

describe('ClusterFile', () => {
  describe('Header Parsing', () => {
    it('should parse CLST format header magic number', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ magic: CLST_MAGIC })
      const header = parseClusterHeader(buffer)

      expect(header.magic).toBe(CLST_MAGIC)
      expect(header.magicString).toBe('CLST')
    })

    it('should parse header version field', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ version: 1 })
      const header = parseClusterHeader(buffer)

      expect(header.version).toBe(1)
    })

    it('should parse header vector count', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ vectorCount: 50000 })
      const header = parseClusterHeader(buffer)

      expect(header.vectorCount).toBe(50000)
    })

    it('should parse cluster ID', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ clusterId: 42 })
      const header = parseClusterHeader(buffer)

      expect(header.clusterId).toBe(42)
    })

    it('should parse M (number of PQ subspaces)', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ M: 16 })
      const header = parseClusterHeader(buffer)

      expect(header.M).toBe(16)
    })

    it('should parse id_type field (uint64 vs string)', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const uint64Buffer = createMockHeader({ idType: ID_TYPE_UINT64 })
      const uint64Header = parseClusterHeader(uint64Buffer)
      expect(uint64Header.idType).toBe(ID_TYPE_UINT64)
      expect(uint64Header.idTypeName).toBe('uint64')

      const stringBuffer = createMockHeader({ idType: ID_TYPE_STRING })
      const stringHeader = parseClusterHeader(stringBuffer)
      expect(stringHeader.idType).toBe(ID_TYPE_STRING)
      expect(stringHeader.idTypeName).toBe('string')
    })

    it('should parse has_metadata flag', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const withMeta = createMockHeader({ hasMetadata: 1 })
      const headerWithMeta = parseClusterHeader(withMeta)
      expect(headerWithMeta.hasMetadata).toBe(true)

      const withoutMeta = createMockHeader({ hasMetadata: 0 })
      const headerWithoutMeta = parseClusterHeader(withoutMeta)
      expect(headerWithoutMeta.hasMetadata).toBe(false)
    })

    it('should throw error for invalid magic number', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ magic: 0x12345678 })

      expect(() => parseClusterHeader(buffer)).toThrow(/invalid.*magic/i)
    })

    it('should throw error for unsupported version', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ version: 99 })

      expect(() => parseClusterHeader(buffer)).toThrow(/unsupported.*version/i)
    })

    it('should throw error for truncated header', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const truncatedBuffer = new ArrayBuffer(32) // Less than 64 bytes

      expect(() => parseClusterHeader(truncatedBuffer)).toThrow(/truncated|too small/i)
    })
  })

  // ============================================================================
  // VECTOR ID EXTRACTION TESTS
  // ============================================================================

  describe('Vector ID Extraction', () => {
    it('should extract uint64 vector IDs', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const ids = [BigInt(100), BigInt(200), BigInt(300)]
      const buffer = createMockClusterFileUint64({
        vectorCount: 3,
        M: 8,
        ids,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.ids).toHaveLength(3)
      expect(cluster.ids[0]).toBe(BigInt(100))
      expect(cluster.ids[1]).toBe(BigInt(200))
      expect(cluster.ids[2]).toBe(BigInt(300))
    })

    it('should extract string vector IDs', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const ids = ['doc-abc123', 'doc-def456', 'doc-ghi789']
      const buffer = createMockClusterFileStringIds({
        M: 8,
        ids,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.ids).toHaveLength(3)
      expect(cluster.ids[0]).toBe('doc-abc123')
      expect(cluster.ids[1]).toBe('doc-def456')
      expect(cluster.ids[2]).toBe('doc-ghi789')
    })

    it('should validate ID count matches header', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // Create buffer with mismatched count
      const buffer = createMockClusterFileUint64({
        vectorCount: 10,
        M: 8,
      })
      // Corrupt the header to claim 20 vectors
      const view = new DataView(buffer)
      view.setUint32(12, 20, true)

      expect(() => parseClusterFile(buffer)).toThrow(/count.*mismatch|truncated/i)
    })

    it('should handle variable-length string IDs', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // Mix of short and long string IDs
      const ids = [
        'a',
        'medium-length-id',
        'this-is-a-very-long-identifier-that-exceeds-typical-lengths-for-testing-purposes',
        'b',
      ]
      const buffer = createMockClusterFileStringIds({
        M: 8,
        ids,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.ids).toHaveLength(4)
      expect(cluster.ids[0]).toBe('a')
      expect(cluster.ids[1]).toBe('medium-length-id')
      expect(cluster.ids[2]).toBe(
        'this-is-a-very-long-identifier-that-exceeds-typical-lengths-for-testing-purposes'
      )
      expect(cluster.ids[3]).toBe('b')
    })

    it('should handle empty string IDs', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const ids = ['', 'non-empty', '']
      const buffer = createMockClusterFileStringIds({
        M: 8,
        ids,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.ids).toHaveLength(3)
      expect(cluster.ids[0]).toBe('')
      expect(cluster.ids[1]).toBe('non-empty')
      expect(cluster.ids[2]).toBe('')
    })

    it('should handle unicode string IDs', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const ids = ['hello-world', 'cafe', 'emoji-test']
      const buffer = createMockClusterFileStringIds({
        M: 8,
        ids,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.ids).toHaveLength(3)
      expect(cluster.ids[0]).toBe('hello-world')
      expect(cluster.ids[1]).toBe('cafe')
      expect(cluster.ids[2]).toBe('emoji-test')
    })
  })

  // ============================================================================
  // PQ CODE EXTRACTION TESTS
  // ============================================================================

  describe('PQ Code Extraction', () => {
    it('should extract PQ codes for each vector', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const M = 8
      const pqCodes = [
        new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
        new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
        new Uint8Array([255, 254, 253, 252, 251, 250, 249, 248]),
      ]

      const buffer = createMockClusterFileUint64({
        vectorCount: 3,
        M,
        pqCodes,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.pqCodes).toBeInstanceOf(Uint8Array)
      // Total codes = vectorCount * M
      expect(cluster.pqCodes.length).toBe(3 * M)

      // Check first vector's codes
      const vector0Codes = cluster.pqCodes.subarray(0, M)
      expect(Array.from(vector0Codes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

      // Check second vector's codes
      const vector1Codes = cluster.pqCodes.subarray(M, 2 * M)
      expect(Array.from(vector1Codes)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])

      // Check third vector's codes
      const vector2Codes = cluster.pqCodes.subarray(2 * M, 3 * M)
      expect(Array.from(vector2Codes)).toEqual([255, 254, 253, 252, 251, 250, 249, 248])
    })

    it('should provide getPQCodes method for specific vector', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const M = 8
      const pqCodes = [
        new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
        new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
      ]

      const buffer = createMockClusterFileUint64({
        vectorCount: 2,
        M,
        pqCodes,
      })

      const cluster = new ClusterFile(buffer)

      const codes0 = cluster.getPQCodes(0)
      expect(Array.from(codes0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

      const codes1 = cluster.getPQCodes(1)
      expect(Array.from(codes1)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
    })

    it('should support different M values (8, 16, 32)', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      for (const M of [8, 16, 32]) {
        const buffer = createMockClusterFileUint64({
          vectorCount: 5,
          M,
        })

        const cluster = parseClusterFile(buffer)

        expect(cluster.header.M).toBe(M)
        expect(cluster.pqCodes.length).toBe(5 * M)
      }
    })

    it('should throw error for invalid PQ code section size', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // Create a buffer that's too small
      const buffer = createMockClusterFileUint64({
        vectorCount: 10,
        M: 8,
      })

      // Truncate the buffer to cut off PQ codes
      const truncated = buffer.slice(0, HEADER_SIZE + 10 * 8 + 5) // Only 5 bytes of PQ codes

      expect(() => parseClusterFile(truncated)).toThrow(/truncated|pq.*codes/i)
    })
  })

  // ============================================================================
  // METADATA EXTRACTION TESTS
  // ============================================================================

  describe('Metadata Extraction (Optional)', () => {
    it('should extract metadata when present', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const metadata = [
        { title: 'Document 1', score: 0.95 },
        { title: 'Document 2', score: 0.87 },
      ]

      const buffer = createMockClusterFileUint64({
        vectorCount: 2,
        M: 8,
        hasMetadata: true,
        metadata,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.hasMetadata).toBe(true)
      expect(cluster.metadata).toBeDefined()
      expect(cluster.metadata).toHaveLength(2)
    })

    it('should return null metadata when not present', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 2,
        M: 8,
        hasMetadata: false,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.hasMetadata).toBe(false)
      expect(cluster.metadata).toBeNull()
    })

    it('should provide getMetadata method for specific vector', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const metadata = [
        { title: 'First' },
        { title: 'Second' },
        { title: 'Third' },
      ]

      const buffer = createMockClusterFileUint64({
        vectorCount: 3,
        M: 8,
        hasMetadata: true,
        metadata,
      })

      const cluster = new ClusterFile(buffer)

      expect(cluster.getMetadata(0)).toEqual({ title: 'First' })
      expect(cluster.getMetadata(1)).toEqual({ title: 'Second' })
      expect(cluster.getMetadata(2)).toEqual({ title: 'Third' })
    })

    it('should handle missing metadata for specific vector gracefully', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 3,
        M: 8,
        hasMetadata: false,
      })

      const cluster = new ClusterFile(buffer)

      expect(cluster.getMetadata(0)).toBeNull()
      expect(cluster.getMetadata(1)).toBeNull()
    })
  })

  // ============================================================================
  // VARIABLE-LENGTH ID HANDLING TESTS
  // ============================================================================

  describe('Variable-Length ID Handling', () => {
    it('should correctly distinguish uint64 vs string ID types', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // uint64 IDs
      const uint64Buffer = createMockClusterFileUint64({
        vectorCount: 3,
        M: 8,
        ids: [BigInt(1), BigInt(2), BigInt(3)],
      })
      const uint64Cluster = parseClusterFile(uint64Buffer)
      expect(uint64Cluster.header.idType).toBe(ID_TYPE_UINT64)
      expect(typeof uint64Cluster.ids[0]).toBe('bigint')

      // String IDs
      const stringBuffer = createMockClusterFileStringIds({
        M: 8,
        ids: ['a', 'b', 'c'],
      })
      const stringCluster = parseClusterFile(stringBuffer)
      expect(stringCluster.header.idType).toBe(ID_TYPE_STRING)
      expect(typeof stringCluster.ids[0]).toBe('string')
    })

    it('should calculate correct section offsets for string IDs', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const ids = ['short', 'a-much-longer-identifier-string']
      const buffer = createMockClusterFileStringIds({
        M: 8,
        ids,
      })

      const cluster = new ClusterFile(buffer)

      // Verify offsets are calculated correctly
      expect(cluster.getIdsSectionOffset()).toBe(HEADER_SIZE)
      expect(cluster.getPQCodesSectionOffset()).toBeGreaterThan(HEADER_SIZE)
    })

    it('should handle maximum length string IDs', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      // Create a very long ID (1KB)
      const longId = 'x'.repeat(1024)
      const ids = [longId, 'short']
      const buffer = createMockClusterFileStringIds({
        M: 8,
        ids,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.ids[0]).toBe(longId)
      expect(cluster.ids[0].length).toBe(1024)
    })
  })

  // ============================================================================
  // EMPTY CLUSTER HANDLING TESTS
  // ============================================================================

  describe('Empty Cluster Handling', () => {
    it('should handle clusters with 0 vectors', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 0,
        M: 8,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.header.vectorCount).toBe(0)
      expect(cluster.ids).toHaveLength(0)
      expect(cluster.pqCodes.length).toBe(0)
    })

    it('should return empty iterator for empty cluster', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 0,
        M: 8,
      })

      const cluster = new ClusterFile(buffer)
      const vectors = [...cluster]

      expect(vectors).toHaveLength(0)
    })

    it('should throw for out-of-bounds access on empty cluster', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 0,
        M: 8,
      })

      const cluster = new ClusterFile(buffer)

      expect(() => cluster.getId(0)).toThrow(/out of bounds|index/i)
      expect(() => cluster.getPQCodes(0)).toThrow(/out of bounds|index/i)
    })
  })

  // ============================================================================
  // LARGE CLUSTER HANDLING TESTS
  // ============================================================================

  describe('Large Cluster Handling (100K+ vectors)', () => {
    it('should handle clusters with 100K vectors', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const vectorCount = 100_000
      const M = 8
      const buffer = createLargeMockClusterFile(vectorCount, M)

      const cluster = parseClusterFile(buffer)

      expect(cluster.header.vectorCount).toBe(vectorCount)
      expect(cluster.ids).toHaveLength(vectorCount)
      expect(cluster.pqCodes.length).toBe(vectorCount * M)
    })

    it('should efficiently parse large cluster headers without loading all data', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const vectorCount = 100_000
      const M = 8
      const buffer = createLargeMockClusterFile(vectorCount, M)

      // Header parsing should be fast regardless of cluster size
      const start = performance.now()
      const header = parseClusterHeader(buffer)
      const elapsed = performance.now() - start

      expect(header.vectorCount).toBe(vectorCount)
      expect(elapsed).toBeLessThan(10) // Header parse should be < 10ms
    })

    it('should support lazy loading of large clusters', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const vectorCount = 100_000
      const M = 8
      const buffer = createLargeMockClusterFile(vectorCount, M)

      // Lazy mode: don't parse all data upfront
      const cluster = new ClusterFile(buffer, { lazy: true })

      expect(cluster.header.vectorCount).toBe(vectorCount)

      // Individual access should work
      const id = cluster.getId(50_000)
      expect(id).toBe(BigInt(50_001))

      const codes = cluster.getPQCodes(50_000)
      expect(codes.length).toBe(M)
    })

    it('should handle maximum cluster size (500K vectors)', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const vectorCount = 500_000
      const M = 8
      const buffer = createLargeMockClusterFile(vectorCount, M)

      const cluster = parseClusterFile(buffer)

      expect(cluster.header.vectorCount).toBe(vectorCount)
    })
  })

  // ============================================================================
  // EFFICIENT ITERATION TESTS
  // ============================================================================

  describe('Efficient Iteration', () => {
    it('should iterate over cluster contents using for...of', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const M = 8
      const buffer = createMockClusterFileUint64({
        vectorCount: 5,
        M,
      })

      const cluster = new ClusterFile(buffer)
      const entries: Array<{ id: bigint | string; codes: Uint8Array }> = []

      for (const entry of cluster) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(5)
      entries.forEach((entry, i) => {
        expect(entry.id).toBe(BigInt(i + 1))
        expect(entry.codes).toBeInstanceOf(Uint8Array)
        expect(entry.codes.length).toBe(M)
      })
    })

    it('should provide batch iteration for efficient processing', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const M = 8
      const buffer = createMockClusterFileUint64({
        vectorCount: 100,
        M,
      })

      const cluster = new ClusterFile(buffer)
      const batches: Array<{ ids: Array<bigint | string>; codes: Uint8Array }> = []

      for (const batch of cluster.batches(25)) {
        batches.push(batch)
      }

      expect(batches).toHaveLength(4) // 100 / 25 = 4 batches
      batches.forEach((batch) => {
        expect(batch.ids).toHaveLength(25)
        expect(batch.codes.length).toBe(25 * M)
      })
    })

    it('should support async iteration for streaming', async () => {
      assertModuleLoaded('ClusterFileIterator', ClusterFileIterator)

      const M = 8
      const buffer = createMockClusterFileUint64({
        vectorCount: 50,
        M,
      })

      const iterator = new ClusterFileIterator(buffer)
      const entries: Array<{ id: bigint | string; codes: Uint8Array }> = []

      for await (const entry of iterator) {
        entries.push(entry)
      }

      expect(entries).toHaveLength(50)
    })

    it('should yield chunks efficiently for large clusters', async () => {
      assertModuleLoaded('ClusterFileIterator', ClusterFileIterator)

      const vectorCount = 10_000
      const M = 8
      const buffer = createLargeMockClusterFile(vectorCount, M)

      const iterator = new ClusterFileIterator(buffer, { chunkSize: 1000 })
      let totalCount = 0

      for await (const chunk of iterator.chunks()) {
        expect(chunk.ids.length).toBeLessThanOrEqual(1000)
        totalCount += chunk.ids.length
      }

      expect(totalCount).toBe(vectorCount)
    })
  })

  // ============================================================================
  // RANDOM ACCESS TESTS
  // ============================================================================

  describe('Random Access by Index', () => {
    it('should access vector by index', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const M = 8
      const buffer = createMockClusterFileUint64({
        vectorCount: 10,
        M,
      })

      const cluster = new ClusterFile(buffer)

      // Access middle element
      const entry = cluster.at(5)
      expect(entry.id).toBe(BigInt(6))
      expect(entry.codes).toBeInstanceOf(Uint8Array)
      expect(entry.codes.length).toBe(M)
    })

    it('should access vector ID by index', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const ids = [BigInt(100), BigInt(200), BigInt(300)]
      const buffer = createMockClusterFileUint64({
        vectorCount: 3,
        M: 8,
        ids,
      })

      const cluster = new ClusterFile(buffer)

      expect(cluster.getId(0)).toBe(BigInt(100))
      expect(cluster.getId(1)).toBe(BigInt(200))
      expect(cluster.getId(2)).toBe(BigInt(300))
    })

    it('should access PQ codes by index', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const M = 8
      const pqCodes = [
        new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
        new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]),
      ]
      const buffer = createMockClusterFileUint64({
        vectorCount: 2,
        M,
        pqCodes,
      })

      const cluster = new ClusterFile(buffer)

      expect(Array.from(cluster.getPQCodes(0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      expect(Array.from(cluster.getPQCodes(1))).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
    })

    it('should throw for negative index', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 10,
        M: 8,
      })

      const cluster = new ClusterFile(buffer)

      expect(() => cluster.at(-1)).toThrow(/index|bounds/i)
    })

    it('should throw for index >= vectorCount', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 10,
        M: 8,
      })

      const cluster = new ClusterFile(buffer)

      expect(() => cluster.at(10)).toThrow(/index|bounds/i)
      expect(() => cluster.at(100)).toThrow(/index|bounds/i)
    })

    it('should support slice access for range of vectors', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const M = 8
      const buffer = createMockClusterFileUint64({
        vectorCount: 100,
        M,
      })

      const cluster = new ClusterFile(buffer)

      // Get vectors 10-19
      const slice = cluster.slice(10, 20)

      expect(slice.ids).toHaveLength(10)
      expect(slice.ids[0]).toBe(BigInt(11))
      expect(slice.ids[9]).toBe(BigInt(20))
      expect(slice.codes.length).toBe(10 * M)
    })

    it('should perform O(1) random access', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const vectorCount = 100_000
      const M = 8
      const buffer = createLargeMockClusterFile(vectorCount, M)

      const cluster = new ClusterFile(buffer)

      // Access at different positions should have similar timing
      const indices = [0, 50_000, 99_999]
      const timings: number[] = []

      for (const idx of indices) {
        const start = performance.now()
        for (let i = 0; i < 1000; i++) {
          cluster.at(idx)
        }
        timings.push(performance.now() - start)
      }

      // All accesses should be within 2x of each other (O(1) behavior)
      const maxTiming = Math.max(...timings)
      const minTiming = Math.min(...timings)
      expect(maxTiming / minTiming).toBeLessThan(3)
    })
  })

  // ============================================================================
  // FILE INTEGRITY / CHECKSUM TESTS
  // ============================================================================

  describe('File Integrity Verification', () => {
    it('should validate file checksum when present', () => {
      assertModuleLoaded('validateClusterChecksum', validateClusterChecksum)

      const buffer = createMockClusterFileWithChecksum(100, 8)

      const result = validateClusterChecksum(buffer)

      expect(result.valid).toBe(true)
      expect(result.hasChecksum).toBe(true)
    })

    it('should detect corrupted data via checksum', () => {
      assertModuleLoaded('validateClusterChecksum', validateClusterChecksum)

      const buffer = createMockClusterFileWithChecksum(100, 8)

      // Corrupt some data
      const uint8View = new Uint8Array(buffer)
      uint8View[HEADER_SIZE + 50] ^= 0xff // Flip bits in ID section

      const result = validateClusterChecksum(buffer)

      expect(result.valid).toBe(false)
      expect(result.hasChecksum).toBe(true)
      expect(result.error).toMatch(/checksum.*mismatch/i)
    })

    it('should return success for file without checksum', () => {
      assertModuleLoaded('validateClusterChecksum', validateClusterChecksum)

      const buffer = createMockClusterFileUint64({
        vectorCount: 100,
        M: 8,
      })

      const result = validateClusterChecksum(buffer)

      expect(result.valid).toBe(true)
      expect(result.hasChecksum).toBe(false)
    })

    it('should detect truncated file', () => {
      assertModuleLoaded('validateClusterChecksum', validateClusterChecksum)

      const buffer = createMockClusterFileWithChecksum(100, 8)

      // Truncate the checksum
      const truncated = buffer.slice(0, buffer.byteLength - 2)

      const result = validateClusterChecksum(truncated)

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/truncated|incomplete/i)
    })

    it('should validate header magic before checksum', () => {
      assertModuleLoaded('validateClusterChecksum', validateClusterChecksum)

      const buffer = createMockClusterFileWithChecksum(100, 8)

      // Corrupt magic number
      const view = new DataView(buffer)
      view.setUint32(0, 0x12345678, true)

      const result = validateClusterChecksum(buffer)

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/magic|invalid.*format/i)
    })
  })

  // ============================================================================
  // CLUSTER FILE CREATION TESTS
  // ============================================================================

  describe('Cluster File Creation', () => {
    it('should create a valid cluster file from data', () => {
      assertModuleLoaded('createClusterFile', createClusterFile)

      const ids = [BigInt(1), BigInt(2), BigInt(3)]
      const pqCodes = [
        new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
        new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]),
        new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27]),
      ]

      const buffer = createClusterFile({
        clusterId: 42,
        ids,
        pqCodes,
        M: 8,
      })

      expect(buffer).toBeInstanceOf(ArrayBuffer)

      // Parse and verify
      const cluster = parseClusterFile(buffer)
      expect(cluster.header.clusterId).toBe(42)
      expect(cluster.header.vectorCount).toBe(3)
      expect(cluster.ids).toEqual(ids)
    })

    it('should create cluster file with string IDs', () => {
      assertModuleLoaded('createClusterFile', createClusterFile)

      const ids = ['doc-1', 'doc-2', 'doc-3']
      const pqCodes = [
        new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
        new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]),
        new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27]),
      ]

      const buffer = createClusterFile({
        clusterId: 0,
        ids,
        pqCodes,
        M: 8,
        idType: 'string',
      })

      const cluster = parseClusterFile(buffer)
      expect(cluster.header.idType).toBe(ID_TYPE_STRING)
      expect(cluster.ids).toEqual(ids)
    })

    it('should create cluster file with metadata', () => {
      assertModuleLoaded('createClusterFile', createClusterFile)

      const ids = [BigInt(1), BigInt(2)]
      const pqCodes = [new Uint8Array(8).fill(0), new Uint8Array(8).fill(1)]
      const metadata = [{ title: 'Doc 1' }, { title: 'Doc 2' }]

      const buffer = createClusterFile({
        clusterId: 0,
        ids,
        pqCodes,
        M: 8,
        metadata,
      })

      const cluster = parseClusterFile(buffer)
      expect(cluster.hasMetadata).toBe(true)
    })

    it('should create cluster file with checksum', () => {
      assertModuleLoaded('createClusterFile', createClusterFile)
      assertModuleLoaded('validateClusterChecksum', validateClusterChecksum)

      const ids = [BigInt(1), BigInt(2), BigInt(3)]
      const pqCodes = [new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)]

      const buffer = createClusterFile({
        clusterId: 0,
        ids,
        pqCodes,
        M: 8,
        includeChecksum: true,
      })

      const result = validateClusterChecksum(buffer)
      expect(result.valid).toBe(true)
      expect(result.hasChecksum).toBe(true)
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle cluster with single vector', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 1,
        M: 8,
        ids: [BigInt(42)],
        pqCodes: [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.header.vectorCount).toBe(1)
      expect(cluster.ids[0]).toBe(BigInt(42))
    })

    it('should handle maximum M value (64 subspaces)', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const M = 64
      const buffer = createMockClusterFileUint64({
        vectorCount: 10,
        M,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.header.M).toBe(64)
      expect(cluster.pqCodes.length).toBe(10 * 64)
    })

    it('should reject M value of 0', () => {
      assertModuleLoaded('parseClusterHeader', parseClusterHeader)

      const buffer = createMockHeader({ M: 0 })

      expect(() => parseClusterHeader(buffer)).toThrow(/invalid.*M|subspaces/i)
    })

    it('should handle all-zero PQ codes', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const pqCodes = [new Uint8Array(8).fill(0), new Uint8Array(8).fill(0)]

      const buffer = createMockClusterFileUint64({
        vectorCount: 2,
        M: 8,
        pqCodes,
      })

      const cluster = parseClusterFile(buffer)

      expect(Array.from(cluster.pqCodes.subarray(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    })

    it('should handle all-255 PQ codes', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const pqCodes = [new Uint8Array(8).fill(255), new Uint8Array(8).fill(255)]

      const buffer = createMockClusterFileUint64({
        vectorCount: 2,
        M: 8,
        pqCodes,
      })

      const cluster = parseClusterFile(buffer)

      expect(Array.from(cluster.pqCodes.subarray(0, 8))).toEqual([
        255, 255, 255, 255, 255, 255, 255, 255,
      ])
    })

    it('should handle maximum cluster ID (uint32 max)', () => {
      assertModuleLoaded('parseClusterFile', parseClusterFile)

      const buffer = createMockClusterFileUint64({
        clusterId: 0xffffffff,
        vectorCount: 1,
        M: 8,
      })

      const cluster = parseClusterFile(buffer)

      expect(cluster.header.clusterId).toBe(0xffffffff)
    })
  })

  // ============================================================================
  // MEMORY EFFICIENCY TESTS
  // ============================================================================

  describe('Memory Efficiency', () => {
    it('should provide size calculation methods', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 1000,
        M: 8,
      })

      const cluster = new ClusterFile(buffer)

      expect(cluster.getHeaderSize()).toBe(HEADER_SIZE)
      expect(cluster.getIdsSectionSize()).toBe(1000 * 8)
      expect(cluster.getPQCodesSectionSize()).toBe(1000 * 8)
      expect(cluster.getTotalSize()).toBe(buffer.byteLength)
    })

    it('should support zero-copy access via ArrayBuffer views', () => {
      assertModuleLoaded('ClusterFile', ClusterFile)

      const buffer = createMockClusterFileUint64({
        vectorCount: 100,
        M: 8,
      })

      const cluster = new ClusterFile(buffer)

      // PQ codes should be a view, not a copy
      const codes = cluster.pqCodes
      expect(codes.buffer).toBe(buffer)
    })
  })
})
