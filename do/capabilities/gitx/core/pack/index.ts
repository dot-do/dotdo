/**
 * @fileoverview Git Pack File Format Implementation
 *
 * This module implements parsing and creation of Git pack files.
 * Pack files are the primary format for storing and transferring Git objects.
 *
 * Pack file format:
 * - Header: "PACK" magic (4 bytes), version (4 bytes), object count (4 bytes)
 * - Objects: sequence of compressed objects with type/size headers
 * - Trailer: SHA-1 checksum of all preceding content (20 bytes)
 *
 * Pack index format (v2):
 * - Header: magic "\377tOc" (4 bytes), version (4 bytes)
 * - Fanout table: 256 x 4-byte cumulative counts
 * - SHA list: sorted SHA-1 hashes
 * - CRC32 list: CRC32 for each object
 * - Offset list: 4-byte offsets (or index into large offset table if MSB set)
 * - Large offset table: 8-byte offsets for files > 2GB
 * - Pack checksum: SHA-1 of pack file (20 bytes)
 * - Index checksum: SHA-1 of index content (20 bytes)
 */

import { pako } from './pako-shim'

// Re-export delta module
export * from './delta'

// =============================================================================
// Constants
// =============================================================================

/** Pack file magic signature */
export const PACK_MAGIC = 'PACK'

/** Current pack file version */
export const PACK_VERSION = 2

/** Pack index magic number (0xff744f63 = "\377tOc") */
export const PACK_INDEX_MAGIC = 0xff744f63

/** Pack index version 2 */
export const PACK_INDEX_VERSION_2 = 2

/** Threshold for large offsets (2GB) */
export const LARGE_OFFSET_THRESHOLD = 0x80000000

// =============================================================================
// Pack Object Types
// =============================================================================

/** Git object types as encoded in pack files */
export enum PackObjectType {
  COMMIT = 1,
  TREE = 2,
  BLOB = 3,
  TAG = 4,
  // Type 5 is reserved
  OFS_DELTA = 6,
  REF_DELTA = 7,
}

export const OBJ_COMMIT = PackObjectType.COMMIT
export const OBJ_TREE = PackObjectType.TREE
export const OBJ_BLOB = PackObjectType.BLOB
export const OBJ_TAG = PackObjectType.TAG
export const OBJ_OFS_DELTA = PackObjectType.OFS_DELTA
export const OBJ_REF_DELTA = PackObjectType.REF_DELTA

// =============================================================================
// Types
// =============================================================================

/** Pack file header */
export interface PackHeader {
  magic: string
  version: number
  objectCount: number
}

/** Pack index entry */
export interface PackIndexEntry {
  sha?: string
  offset: number
  crc32: number
}

/** Fanout table type */
export type FanoutTable = Uint32Array

/** Complete pack index */
export interface PackIndex {
  version: number
  objectCount: number
  fanout: FanoutTable
  entries: PackIndexEntry[]
  packChecksum: Uint8Array
  indexChecksum: Uint8Array
}

/** Parsed pack object */
export interface ParsedPackObject {
  type: number
  size: number
  data: Uint8Array
  offset: number
  sha?: string
  crc32?: number
}

// =============================================================================
// Pack Header Operations
// =============================================================================

/**
 * Parse a pack file header.
 */
export function parsePackHeader(data: Uint8Array, offset = 0): PackHeader {
  if (data.length - offset < 12) {
    throw new Error('Pack header too short or truncated')
  }

  // Check magic signature
  const magic = String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3]
  )

  if (magic !== PACK_MAGIC) {
    throw new Error(`Invalid pack signature: expected "PACK", got "${magic}"`)
  }

  // Parse version (big-endian)
  const version =
    (data[offset + 4] << 24) |
    (data[offset + 5] << 16) |
    (data[offset + 6] << 8) |
    data[offset + 7]

  if (version !== 2) {
    throw new Error(`Unsupported pack version: ${version} (only version 2 is supported)`)
  }

  // Parse object count (big-endian)
  const objectCount =
    ((data[offset + 8] << 24) |
      (data[offset + 9] << 16) |
      (data[offset + 10] << 8) |
      data[offset + 11]) >>>
    0

  return { magic, version, objectCount }
}

/**
 * Create a pack file header.
 */
export function createPackHeader(objectCount: number): Uint8Array {
  const header = new Uint8Array(12)

  // Magic: "PACK"
  header[0] = 0x50 // P
  header[1] = 0x41 // A
  header[2] = 0x43 // C
  header[3] = 0x4b // K

  // Version: 2 (big-endian)
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = 2

  // Object count (big-endian)
  header[8] = (objectCount >>> 24) & 0xff
  header[9] = (objectCount >>> 16) & 0xff
  header[10] = (objectCount >>> 8) & 0xff
  header[11] = objectCount & 0xff

  return header
}

/**
 * Validate a pack file header.
 */
export function validatePackHeader(data: Uint8Array): boolean {
  try {
    parsePackHeader(data)
    return true
  } catch {
    return false
  }
}

// =============================================================================
// Object Header Encoding/Decoding
// =============================================================================

/**
 * Encode a variable-length size value.
 */
export function encodeVariableLengthSize(size: number): Uint8Array {
  const bytes: number[] = []
  let value = size

  do {
    let byte = value & 0x7f
    value = Math.floor(value / 128)

    if (value > 0) {
      byte |= 0x80
    }

    bytes.push(byte)
  } while (value > 0)

  return new Uint8Array(bytes)
}

/**
 * Decode a variable-length size value.
 */
export function decodeVariableLengthSize(
  data: Uint8Array,
  offset: number
): { value: number; bytesRead: number } {
  let value = 0
  let shift = 0
  let bytesRead = 0

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new Error('Truncated varint - end of data')
    }

    const byte = data[offset + bytesRead]
    bytesRead++

    value |= (byte & 0x7f) << shift
    shift += 7

    if ((byte & 0x80) === 0) {
      break
    }

    if (bytesRead > 10) {
      throw new Error('Varint too long')
    }
  }

  return { value, bytesRead }
}

/**
 * Encode a pack object header (type + size).
 *
 * Format:
 * - First byte: CTTT SSSS (C=continuation, T=type, S=size bits 0-3)
 * - Subsequent bytes: CSSS SSSS (C=continuation, S=size bits)
 */
export function encodeObjectHeader(type: number, size: number): Uint8Array {
  const bytes: number[] = []

  // First byte: type in bits 4-6, size bits 0-3 in bits 0-3
  let firstByte = ((type & 0x07) << 4) | (size & 0x0f)
  let remaining = size >>> 4

  if (remaining > 0) {
    firstByte |= 0x80
  }

  bytes.push(firstByte)

  // Subsequent bytes for remaining size
  while (remaining > 0) {
    let byte = remaining & 0x7f
    remaining = remaining >>> 7

    if (remaining > 0) {
      byte |= 0x80
    }

    bytes.push(byte)
  }

  return new Uint8Array(bytes)
}

/**
 * Decode a pack object header.
 */
export function decodeObjectHeader(
  data: Uint8Array,
  offset: number
): { type: number; size: number; bytesRead: number } {
  if (offset >= data.length) {
    throw new Error('Offset beyond buffer bounds')
  }

  const firstByte = data[offset]
  const type = (firstByte >> 4) & 0x07
  let size = firstByte & 0x0f
  let bytesRead = 1
  let shift = 4

  // Continue reading if continuation bit is set
  while (data[offset + bytesRead - 1] & 0x80) {
    if (offset + bytesRead >= data.length) {
      throw new Error('Truncated object header')
    }

    const byte = data[offset + bytesRead]
    size |= (byte & 0x7f) << shift
    shift += 7
    bytesRead++
  }

  return { type, size, bytesRead }
}

// =============================================================================
// Pack Checksum
// =============================================================================

/**
 * Compute SHA-1 checksum of pack content.
 * Uses a pure JS implementation for synchronous operation.
 */
export function computePackChecksum(data: Uint8Array): Uint8Array {
  return sha1(data)
}

/**
 * Verify pack file checksum.
 */
export function verifyPackChecksum(pack: Uint8Array): boolean {
  if (pack.length < 20) {
    throw new Error('Pack too short for checksum')
  }

  const content = pack.slice(0, -20)
  const storedChecksum = pack.slice(-20)
  const computedChecksum = computePackChecksum(content)

  return arrayEquals(storedChecksum, computedChecksum)
}

/**
 * Pure JavaScript SHA-1 implementation.
 * Based on FIPS 180-4 specification.
 */
function sha1(data: Uint8Array): Uint8Array {
  // Initial hash values
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  // Pre-processing: adding padding bits
  const ml = data.length * 8 // message length in bits
  const paddingLength = (55 - (data.length % 64) + 64) % 64 + 1

  const padded = new Uint8Array(data.length + paddingLength + 8)
  padded.set(data)
  padded[data.length] = 0x80

  // Append message length in bits as 64-bit big-endian
  const view = new DataView(padded.buffer)
  // JavaScript numbers lose precision above 2^53, but message length is usually much smaller
  view.setUint32(padded.length - 8, Math.floor(ml / 0x100000000), false)
  view.setUint32(padded.length - 4, ml >>> 0, false)

  // Process each 512-bit (64-byte) chunk
  const w = new Uint32Array(80)

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    // Break chunk into sixteen 32-bit big-endian words
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunkStart + i * 4, false)
    }

    // Extend the sixteen 32-bit words into eighty 32-bit words
    for (let i = 16; i < 80; i++) {
      const val = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (val << 1) | (val >>> 31) // Left rotate by 1
    }

    // Initialize working variables
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    // Main loop
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number

      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp
    }

    // Add this chunk's hash to result so far
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  // Produce the final hash value (big-endian)
  const result = new Uint8Array(20)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(0, h0, false)
  resultView.setUint32(4, h1, false)
  resultView.setUint32(8, h2, false)
  resultView.setUint32(12, h3, false)
  resultView.setUint32(16, h4, false)

  return result
}

// =============================================================================
// Fanout Table Operations
// =============================================================================

/**
 * Parse a fanout table from raw bytes.
 */
export function parseFanoutTable(data: Uint8Array): FanoutTable {
  const fanout = new Uint32Array(256)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  for (let i = 0; i < 256; i++) {
    fanout[i] = view.getUint32(i * 4, false) // big-endian
  }

  return fanout
}

/**
 * Create a fanout table from sorted entries.
 */
export function createFanoutTable(entries: PackIndexEntry[]): FanoutTable {
  const fanout = new Uint32Array(256)
  let count = 0

  for (let i = 0; i < 256; i++) {
    while (
      count < entries.length &&
      parseInt(entries[count].sha!.slice(0, 2), 16) <= i
    ) {
      count++
    }
    fanout[i] = count
  }

  return fanout
}

/**
 * Get the search range for a SHA from the fanout table.
 */
export function getFanoutRange(
  fanout: FanoutTable,
  firstByte: number
): { start: number; end: number } {
  const start = firstByte === 0 ? 0 : fanout[firstByte - 1]
  const end = fanout[firstByte]
  return { start, end }
}

// =============================================================================
// Pack Index Operations
// =============================================================================

/**
 * Parse a pack index file (v2).
 */
export function parsePackIndex(data: Uint8Array): PackIndex {
  // Check minimum size (header + fanout + checksums)
  const minSize = 8 + 256 * 4 + 40
  if (data.length < minSize) {
    throw new Error('Pack index truncated or too short')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // Parse header
  const magic = view.getUint32(0, false)
  if (magic !== PACK_INDEX_MAGIC) {
    throw new Error(`Invalid pack index magic/signature: 0x${magic.toString(16)}`)
  }

  const version = view.getUint32(4, false)
  if (version !== PACK_INDEX_VERSION_2) {
    throw new Error(`Unsupported pack index version: ${version}`)
  }

  // Parse fanout table
  const fanoutData = data.slice(8, 8 + 256 * 4)
  const fanout = parseFanoutTable(fanoutData)

  // Validate fanout is monotonically non-decreasing
  for (let i = 1; i < 256; i++) {
    if (fanout[i] < fanout[i - 1]) {
      throw new Error(`Invalid fanout table: non-monotonic at index ${i}`)
    }
  }

  const objectCount = fanout[255]

  // Calculate section offsets
  let offset = 8 + 256 * 4 // After header and fanout

  // SHA list (20 bytes per entry)
  const shaListStart = offset
  offset += objectCount * 20

  // CRC32 list (4 bytes per entry)
  const crcListStart = offset
  offset += objectCount * 4

  // Offset list (4 bytes per entry)
  const offsetListStart = offset
  offset += objectCount * 4

  // Check if we have large offsets
  const largeOffsetCount = countLargeOffsets(
    data,
    offsetListStart,
    objectCount
  )
  const largeOffsetStart = offset
  offset += largeOffsetCount * 8

  // Checksums at the end
  const packChecksumStart = offset
  const indexChecksumStart = offset + 20

  if (indexChecksumStart + 20 > data.length) {
    throw new Error('Pack index truncated - missing checksums')
  }

  // Parse entries
  const entries: PackIndexEntry[] = []

  for (let i = 0; i < objectCount; i++) {
    // SHA
    const shaBytes = data.slice(shaListStart + i * 20, shaListStart + (i + 1) * 20)
    const sha = Array.from(shaBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // CRC32
    const crc32 = view.getUint32(crcListStart + i * 4, false)

    // Offset
    let entryOffset = view.getUint32(offsetListStart + i * 4, false)

    // Check for large offset
    if (entryOffset & 0x80000000) {
      const largeIndex = entryOffset & 0x7fffffff
      entryOffset = readLargeOffset(data, largeOffsetStart + largeIndex * 8)
    }

    entries.push({ sha, offset: entryOffset, crc32 })
  }

  return {
    version,
    objectCount,
    fanout,
    entries,
    packChecksum: data.slice(packChecksumStart, packChecksumStart + 20),
    indexChecksum: data.slice(indexChecksumStart, indexChecksumStart + 20),
  }
}

/**
 * Create a pack index from entries.
 */
export function createPackIndex(
  entries: PackIndexEntry[],
  packChecksum: Uint8Array
): Uint8Array {
  // Sort entries by SHA
  const sortedEntries = [...entries].sort((a, b) =>
    a.sha!.localeCompare(b.sha!)
  )

  const objectCount = sortedEntries.length

  // Calculate sizes
  let largeOffsetCount = 0
  for (const entry of sortedEntries) {
    if (isLargeOffset(entry.offset)) {
      largeOffsetCount++
    }
  }

  const size =
    8 + // header
    256 * 4 + // fanout
    objectCount * 20 + // SHAs
    objectCount * 4 + // CRCs
    objectCount * 4 + // offsets
    largeOffsetCount * 8 + // large offsets
    20 + // pack checksum
    20 // index checksum

  const result = new Uint8Array(size)
  const view = new DataView(result.buffer)
  let offset = 0

  // Header
  view.setUint32(offset, PACK_INDEX_MAGIC, false)
  offset += 4
  view.setUint32(offset, PACK_INDEX_VERSION_2, false)
  offset += 4

  // Fanout table
  const fanout = createFanoutTable(sortedEntries)
  for (let i = 0; i < 256; i++) {
    view.setUint32(offset, fanout[i], false)
    offset += 4
  }

  // SHA list
  for (const entry of sortedEntries) {
    const shaBytes = hexToBytes(entry.sha!)
    result.set(shaBytes, offset)
    offset += 20
  }

  // CRC32 list
  for (const entry of sortedEntries) {
    view.setUint32(offset, entry.crc32, false)
    offset += 4
  }

  // Offset list (and build large offset table)
  const largeOffsets: number[] = []
  const offsetListStart = offset

  for (let i = 0; i < objectCount; i++) {
    const entry = sortedEntries[i]

    if (isLargeOffset(entry.offset)) {
      // Mark as large offset and record index
      view.setUint32(offsetListStart + i * 4, 0x80000000 | largeOffsets.length, false)
      largeOffsets.push(entry.offset)
    } else {
      view.setUint32(offsetListStart + i * 4, entry.offset, false)
    }
  }
  offset += objectCount * 4

  // Large offset table
  for (const largeOffset of largeOffsets) {
    writeLargeOffset(result, offset, largeOffset)
    offset += 8
  }

  // Pack checksum
  result.set(packChecksum, offset)
  offset += 20

  // Index checksum (computed over everything before it)
  const indexContent = result.slice(0, offset)
  const indexChecksum = computePackChecksum(indexContent)
  result.set(indexChecksum, offset)

  return result
}

/**
 * Serialize a pack index to bytes.
 */
export function serializePackIndex(index: PackIndex): Uint8Array {
  return createPackIndex(index.entries, index.packChecksum)
}

/**
 * Look up an object in a pack index.
 */
export function lookupObjectInIndex(
  index: PackIndex,
  sha: string
): PackIndexEntry | null {
  // Validate SHA
  if (sha.length !== 40 || !/^[0-9a-f]+$/i.test(sha)) {
    throw new Error(`Invalid SHA: ${sha}`)
  }

  const normalizedSha = sha.toLowerCase()
  const firstByte = parseInt(normalizedSha.slice(0, 2), 16)
  const { start, end } = getFanoutRange(index.fanout, firstByte)

  // Binary search within the range
  let lo = start
  let hi = end

  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const entrySha = index.entries[mid].sha!

    if (entrySha < normalizedSha) {
      lo = mid + 1
    } else if (entrySha > normalizedSha) {
      hi = mid
    } else {
      return index.entries[mid]
    }
  }

  return null
}

// =============================================================================
// CRC32 Calculation
// =============================================================================

/** CRC32 lookup table (IEEE polynomial) */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[i] = crc
  }

  return table
})()

/**
 * Calculate CRC32 checksum (IEEE 802.3 polynomial).
 */
export function calculateCRC32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

// =============================================================================
// Large Offset Handling
// =============================================================================

/**
 * Check if an offset requires 8-byte encoding.
 */
export function isLargeOffset(offset: number): boolean {
  return offset >= LARGE_OFFSET_THRESHOLD
}

/**
 * Read an 8-byte offset from buffer.
 */
export function readLargeOffset(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const high = view.getUint32(offset, false)
  const low = view.getUint32(offset + 4, false)

  // Combine as 64-bit number (may lose precision for very large values)
  return high * 0x100000000 + low
}

/**
 * Write an 8-byte offset to buffer.
 */
export function writeLargeOffset(
  data: Uint8Array,
  offset: number,
  value: number
): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const high = Math.floor(value / 0x100000000)
  const low = value % 0x100000000

  view.setUint32(offset, high, false)
  view.setUint32(offset + 4, low, false)
}

// =============================================================================
// Delta Offset Encoding
// =============================================================================

/**
 * Parse an OFS_DELTA offset encoding.
 */
export function parseDeltaOffset(
  data: Uint8Array,
  pos: number
): { offset: number; bytesRead: number } {
  let byte = data[pos]
  let offset = byte & 0x7f
  let bytesRead = 1

  while (byte & 0x80) {
    if (pos + bytesRead >= data.length) {
      throw new Error('Truncated OFS_DELTA offset')
    }
    offset += 1
    offset <<= 7
    byte = data[pos + bytesRead]
    offset |= byte & 0x7f
    bytesRead++
  }

  return { offset, bytesRead }
}

/**
 * Encode an OFS_DELTA offset.
 */
export function encodeDeltaOffset(offset: number): Uint8Array {
  if (offset <= 0) {
    throw new Error('Invalid OFS_DELTA offset: must be positive')
  }

  const bytes: number[] = []
  let value = offset

  // First byte (lowest 7 bits)
  bytes.unshift(value & 0x7f)
  value = Math.floor(value / 128)

  // Subsequent bytes with continuation bit
  while (value > 0) {
    value--
    bytes.unshift(0x80 | (value & 0x7f))
    value = Math.floor(value / 128)
  }

  return new Uint8Array(bytes)
}

// =============================================================================
// Pack Parser
// =============================================================================

/**
 * Pack file parser.
 */
export class PackParser {
  private _data: Uint8Array
  private header: PackHeader

  constructor(data: Uint8Array) {
    if (data.length < 12) {
      throw new Error('Pack data too short')
    }

    this._data = data
    this.header = parsePackHeader(data)
  }

  getData(): Uint8Array {
    return this._data
  }

  getHeader(): PackHeader {
    return this.header
  }

  getObjectCount(): number {
    return this.header.objectCount
  }
}

/**
 * Iterator for pack objects.
 */
export class PackObjectIterator implements Iterable<ParsedPackObject> {
  private data: Uint8Array
  private header: PackHeader

  constructor(data: Uint8Array) {
    this.data = data
    this.header = parsePackHeader(data)
  }

  *[Symbol.iterator](): Iterator<ParsedPackObject> {
    let offset = 12 // After header

    for (let i = 0; i < this.header.objectCount; i++) {
      const objectStart = offset

      // Decode object header
      const { type, size, bytesRead: headerSize } = decodeObjectHeader(
        this.data,
        offset
      )
      offset += headerSize

      // Handle delta types - skip delta header bytes
      if (type === OBJ_OFS_DELTA) {
        const result = parseDeltaOffset(this.data, offset)
        // deltaOffset = result.offset (available in result if needed)
        offset += result.bytesRead
      } else if (type === OBJ_REF_DELTA) {
        // deltaRef would be this.data.slice(offset, offset + 20) if needed
        offset += 20
      }

      // Find compressed data end by decompressing
      const compressed = this.data.slice(offset)
      const decompressed = pako.inflate(compressed)

      // Calculate compressed size
      const inflator = new pako.Inflate()
      inflator.push(compressed, true)
      const compressedSize = (inflator as any).strm?.next_in ?? size

      offset += compressedSize

      yield {
        type,
        size,
        data: decompressed,
        offset: objectStart,
      }
    }
  }
}

// =============================================================================
// Pack Writer
// =============================================================================

/**
 * Pack file writer.
 */
export class PackWriter {
  private objects: Array<{ type: number; data: Uint8Array }> = []

  addObject(type: number, data: Uint8Array): void {
    this.objects.push({ type, data })
  }

  getObjectCount(): number {
    return this.objects.length
  }

  finalize(): Uint8Array {
    const chunks: Uint8Array[] = []

    // Header
    chunks.push(createPackHeader(this.objects.length))

    // Objects
    for (const { type, data } of this.objects) {
      // Object header
      chunks.push(encodeObjectHeader(type, data.length))

      // Compressed data
      const compressed = pako.deflate(data)
      chunks.push(compressed)
    }

    // Concatenate all chunks
    const packWithoutChecksum = concatArrays(chunks)

    // Compute and append checksum
    const checksum = computePackChecksum(packWithoutChecksum)
    const result = new Uint8Array(packWithoutChecksum.length + 20)
    result.set(packWithoutChecksum)
    result.set(checksum, packWithoutChecksum.length)

    return result
  }
}

// =============================================================================
// Helpers
// =============================================================================

function arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function countLargeOffsets(
  data: Uint8Array,
  offsetListStart: number,
  count: number
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let largeCount = 0

  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(offsetListStart + i * 4, false)
    if (offset & 0x80000000) {
      largeCount++
    }
  }

  return largeCount
}
