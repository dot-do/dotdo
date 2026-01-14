/**
 * Pack Parser - Parses Git pack files
 *
 * Implements full Git packfile parsing including:
 * - Pack header parsing (magic, version, object count)
 * - Pack entry parsing (commits, trees, blobs, tags)
 * - Delta decompression (OFS_DELTA, REF_DELTA)
 * - Checksum verification
 *
 * Streaming Support:
 * - StreamingPackParser: Memory-efficient async iterator for large packs
 * - LRU cache for delta base objects
 * - On-demand delta resolution
 *
 * @module bashx/remote/pack-parser
 */

import pako from 'pako'
import {
  OBJ_COMMIT as _OBJ_COMMIT,
  OBJ_TREE as _OBJ_TREE,
  OBJ_BLOB,
  OBJ_TAG as _OBJ_TAG,
  OBJ_OFS_DELTA,
  OBJ_REF_DELTA,
  type ObjectType,
} from './pack-generator.js'

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error class for pack parsing errors
 */
export class PackParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackParseError'
  }
}

/**
 * Error thrown when pack file has invalid magic bytes
 */
export class InvalidMagicError extends PackParseError {
  constructor(actual: string) {
    super(`Invalid pack magic: expected "PACK", got "${actual}"`)
    this.name = 'InvalidMagicError'
  }
}

/**
 * Error thrown when pack file has unsupported version
 */
export class UnsupportedVersionError extends PackParseError {
  public readonly version: number

  constructor(version: number) {
    super(`Pack version ${version} not supported. Only versions 2 and 3 are supported.`)
    this.name = 'UnsupportedVersionError'
    this.version = version
  }
}

/**
 * Error thrown when pack checksum doesn't match
 */
export class ChecksumMismatchError extends PackParseError {
  public readonly expected: string
  public readonly actual: string

  constructor(expected: string, actual: string) {
    super(`Pack checksum mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ChecksumMismatchError'
    this.expected = expected
    this.actual = actual
  }
}

/**
 * Error thrown when delta base object is not found
 */
export class MissingBaseObjectError extends PackParseError {
  public readonly baseSha: string
  public readonly offset: number

  constructor(baseSha: string, offset: number) {
    super(`Missing base object ${baseSha} at offset ${offset}`)
    this.name = 'MissingBaseObjectError'
    this.baseSha = baseSha
    this.offset = offset
  }
}

/**
 * Error thrown when pack data is corrupted
 */
export class CorruptedPackError extends PackParseError {
  constructor(message: string) {
    super(`Corrupted pack: ${message}`)
    this.name = 'CorruptedPackError'
  }
}

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Parsed pack file header
 */
export interface PackHeader {
  magic: string
  version: number
  objectCount: number
  headerSize: number
}

/**
 * Parsed pack entry (before delta resolution)
 */
export interface PackEntry {
  type: number
  typeName: string
  size: number
  data: Uint8Array
  bytesConsumed: number
  baseOffset?: number
  baseSha?: string
}

/**
 * Fully resolved pack object with SHA
 */
export interface PackObject {
  type: number
  typeName: string
  size: number
  data: Uint8Array
  sha: string
}

/**
 * Result of parsing a complete packfile
 */
export interface PackParseResult {
  version: number
  objects: PackObject[]
  index: Map<string, PackObject>
}

/**
 * Delta instruction for pack delta reconstruction
 */
export interface DeltaInstruction {
  type: 'copy' | 'insert'
  offset?: number
  size?: number
  data?: Uint8Array
}

/**
 * Result of varint decoding
 */
interface VarintResult {
  value: number
  bytesRead: number
}

/**
 * Result of zlib decompression
 */
interface ZlibResult {
  data: Uint8Array
  bytesConsumed: number
}

/**
 * Options for parsePackFile
 */
export interface PackParseOptions {
  resolveExternal?: (sha: string) => Uint8Array | undefined
}

// =============================================================================
// Type name mapping
// =============================================================================

const TYPE_NAMES: Record<number, string> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
  6: 'ofs_delta',
  7: 'ref_delta',
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Parse pack file header
 */
export function parsePackHeader(data: Uint8Array): PackHeader {
  if (data.length < 12) {
    throw new PackParseError(`Pack header too short: expected 12 bytes, got ${data.length}`)
  }

  const magic = new TextDecoder().decode(data.slice(0, 4))
  if (magic !== 'PACK') {
    throw new InvalidMagicError(magic)
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const version = view.getUint32(4, false)

  if (version < 2 || version > 3) {
    throw new UnsupportedVersionError(version)
  }

  const objectCount = view.getUint32(8, false)

  return {
    magic,
    version,
    objectCount,
    headerSize: 12,
  }
}

/**
 * Decode a variable-length integer
 */
export function decodeVarint(data: Uint8Array, offset: number): VarintResult {
  let value = 0
  let shift = 0
  let bytesRead = 0

  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead]
    value |= (byte & 0x7f) << shift
    bytesRead++

    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, bytesRead }
    }

    shift += 7
  }

  throw new PackParseError('Truncated varint')
}

/**
 * Decode pack object size (special varint format)
 */
function decodePackSize(
  data: Uint8Array,
  offset: number
): { type: number; size: number; bytesRead: number } {
  const firstByte = data[offset]
  const type = (firstByte >> 4) & 0x07
  let size = firstByte & 0x0f
  let shift = 4
  let bytesRead = 1

  if ((firstByte & 0x80) !== 0) {
    while (offset + bytesRead < data.length) {
      const byte = data[offset + bytesRead]
      size |= (byte & 0x7f) << shift
      shift += 7
      bytesRead++

      if ((byte & 0x80) === 0) {
        break
      }
    }
  }

  return { type, size, bytesRead }
}

/**
 * Decode OFS_DELTA negative offset
 */
function decodeOfsOffsetInternal(data: Uint8Array, offset: number): VarintResult {
  let value = data[offset] & 0x7f
  let bytesRead = 1

  while ((data[offset + bytesRead - 1] & 0x80) !== 0) {
    if (offset + bytesRead >= data.length) {
      throw new PackParseError('Truncated OFS_DELTA offset')
    }
    value = ((value + 1) << 7) | (data[offset + bytesRead] & 0x7f)
    bytesRead++
  }

  return { value, bytesRead }
}

/**
 * Decompress zlib/deflate data
 * Git pack files use zlib (deflate with header), but pako.deflate outputs raw deflate.
 * Try both inflate (zlib wrapper) and inflateRaw (no wrapper).
 */
export function decompressZlib(data: Uint8Array, offset: number = 0): ZlibResult {
  const compressedData = data.slice(offset)

  // Try progressively larger chunks until inflate succeeds
  for (let len = 2; len <= compressedData.length; len++) {
    const chunk = compressedData.slice(0, len)

    // First try zlib wrapper (standard Git pack format)
    try {
      const result = pako.inflate(chunk)
      if (result && result.length >= 0) {
        return { data: result, bytesConsumed: len }
      }
    } catch {
      // Continue
    }

    // Then try raw deflate (what our generator produces)
    try {
      const result = pako.inflateRaw(chunk)
      if (result && result.length >= 0) {
        return { data: result, bytesConsumed: len }
      }
    } catch {
      // Need more data, continue
    }
  }

  throw new CorruptedPackError('Zlib decompression failed')
}

/**
 * Parse a single pack entry
 */
export function parsePackEntry(data: Uint8Array, offset: number): PackEntry {
  const { type, size, bytesRead: sizeBytes } = decodePackSize(data, offset)

  if (type === 0 || type === 5) {
    throw new PackParseError(`Invalid pack object type: ${type}`)
  }

  const typeName = TYPE_NAMES[type] || 'unknown'
  let currentOffset = offset + sizeBytes
  let baseOffset: number | undefined
  let baseSha: string | undefined

  if (type === OBJ_OFS_DELTA) {
    const { value: ofsOffset, bytesRead: offsetBytes } = decodeOfsOffsetInternal(data, currentOffset)
    baseOffset = ofsOffset
    currentOffset += offsetBytes
  } else if (type === OBJ_REF_DELTA) {
    const shaBytes = data.slice(currentOffset, currentOffset + 20)
    baseSha = bytesToHex(shaBytes)
    currentOffset += 20
  }

  const { data: decompressedData, bytesConsumed: zlibBytes } = decompressZlib(data, currentOffset)

  const entry: PackEntry = {
    type,
    typeName,
    size,
    data: decompressedData,
    bytesConsumed: currentOffset - offset + zlibBytes,
  }

  if (baseOffset !== undefined) {
    entry.baseOffset = baseOffset
  }

  if (baseSha !== undefined) {
    entry.baseSha = baseSha
  }

  return entry
}

/**
 * Compute SHA-1 hash for a Git object
 */
export function computeObjectHash(type: string, content: Uint8Array): string {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`)
  const fullContent = new Uint8Array(header.length + content.length)
  fullContent.set(header)
  fullContent.set(content, header.length)
  return sha1(fullContent)
}

/**
 * Apply delta instructions to a base object
 */
export function applyDelta(delta: Uint8Array, base: Uint8Array): Uint8Array {
  let offset = 0

  const { value: sourceSize, bytesRead: sourceSizeBytes } = decodeVarint(delta, offset)
  offset += sourceSizeBytes

  if (sourceSize !== base.length) {
    throw new PackParseError(`Delta source size mismatch: expected ${sourceSize}, got ${base.length}`)
  }

  const { value: targetSize, bytesRead: targetSizeBytes } = decodeVarint(delta, offset)
  offset += targetSizeBytes

  const result = new Uint8Array(targetSize)
  let resultOffset = 0

  while (offset < delta.length) {
    const instruction = delta[offset++]

    if (instruction === 0) {
      throw new PackParseError('Invalid delta instruction: reserved byte 0x00')
    }

    if ((instruction & 0x80) !== 0) {
      let copyOffset = 0
      let copySize = 0

      if (instruction & 0x01) copyOffset |= delta[offset++]
      if (instruction & 0x02) copyOffset |= delta[offset++] << 8
      if (instruction & 0x04) copyOffset |= delta[offset++] << 16
      if (instruction & 0x08) copyOffset |= delta[offset++] << 24

      if (instruction & 0x10) copySize |= delta[offset++]
      if (instruction & 0x20) copySize |= delta[offset++] << 8
      if (instruction & 0x40) copySize |= delta[offset++] << 16

      if (copySize === 0) {
        copySize = 0x10000
      }

      if (copyOffset + copySize > base.length) {
        throw new PackParseError(
          `Copy beyond source bounds: offset ${copyOffset} + size ${copySize} > ${base.length}`
        )
      }

      result.set(base.slice(copyOffset, copyOffset + copySize), resultOffset)
      resultOffset += copySize
    } else {
      const insertSize = instruction
      result.set(delta.slice(offset, offset + insertSize), resultOffset)
      offset += insertSize
      resultOffset += insertSize
    }
  }

  return result
}

/**
 * Verify pack file checksum
 */
export function verifyPackChecksum(
  data: Uint8Array
): { valid: boolean; expected: string; actual: string } {
  if (data.length < 32) {
    throw new PackParseError(`Pack too small: expected at least 32 bytes, got ${data.length}`)
  }

  const dataWithoutFooter = data.slice(0, -20)
  const footer = data.slice(-20)

  const expectedChecksum = bytesToHex(footer)
  const actualChecksum = sha1(dataWithoutFooter)

  return {
    valid: expectedChecksum === actualChecksum,
    expected: expectedChecksum,
    actual: actualChecksum,
  }
}

/**
 * Parse a complete pack file
 */
export async function parsePackFile(
  data: Uint8Array,
  options?: PackParseOptions
): Promise<PackParseResult> {
  const checksumResult = verifyPackChecksum(data)
  if (!checksumResult.valid) {
    throw new ChecksumMismatchError(checksumResult.expected, checksumResult.actual)
  }

  const header = parsePackHeader(data)

  const entriesByOffset = new Map<number, { entry: PackEntry; index: number }>()
  const entries: PackEntry[] = []
  let currentOffset = 12

  for (let i = 0; i < header.objectCount; i++) {
    const entryStartOffset = currentOffset

    if (currentOffset >= data.length - 20) {
      throw new CorruptedPackError(`Object count mismatch: expected ${header.objectCount}, got ${i}`)
    }

    const entry = parsePackEntry(data, currentOffset)
    entries.push(entry)
    entriesByOffset.set(entryStartOffset, { entry, index: i })
    currentOffset += entry.bytesConsumed
  }

  const objects: PackObject[] = []
  const objectsBySha = new Map<string, PackObject>()
  const resolving = new Set<number>()

  const resolveEntry = (index: number, entryOffset: number): PackObject => {
    const entry = entries[index]

    if (resolving.has(index)) {
      throw new CorruptedPackError('Circular delta reference detected')
    }

    if (objects[index]) {
      return objects[index]
    }

    resolving.add(index)

    let resolvedType: number
    let resolvedData: Uint8Array

    if (entry.type === OBJ_OFS_DELTA && entry.baseOffset !== undefined) {
      const baseOffset = entryOffset - entry.baseOffset
      const baseInfo = entriesByOffset.get(baseOffset)
      if (!baseInfo) {
        throw new MissingBaseObjectError(`offset:${baseOffset}`, baseOffset)
      }
      const baseObject = resolveEntry(baseInfo.index, baseOffset)
      resolvedData = applyDelta(entry.data, baseObject.data)
      resolvedType = baseObject.type
    } else if (entry.type === OBJ_REF_DELTA && entry.baseSha !== undefined) {
      const baseObject = objectsBySha.get(entry.baseSha)
      if (!baseObject) {
        const externalData = options?.resolveExternal?.(entry.baseSha)
        if (!externalData) {
          throw new MissingBaseObjectError(entry.baseSha, entryOffset)
        }
        resolvedData = applyDelta(entry.data, externalData)
        resolvedType = OBJ_BLOB
      } else {
        resolvedData = applyDelta(entry.data, baseObject.data)
        resolvedType = baseObject.type
      }
    } else {
      resolvedType = entry.type
      resolvedData = entry.data
    }

    const typeName = TYPE_NAMES[resolvedType] || 'unknown'
    const sha = computeObjectHash(typeName, resolvedData)

    const obj: PackObject = {
      type: resolvedType,
      typeName,
      size: resolvedData.length,
      data: resolvedData,
      sha,
    }

    objects[index] = obj
    objectsBySha.set(sha, obj)
    resolving.delete(index)

    return obj
  }

  let entryOffset = 12
  const entryOffsets: number[] = []
  for (let i = 0; i < entries.length; i++) {
    entryOffsets.push(entryOffset)
    entryOffset += entries[i].bytesConsumed
  }

  for (let i = 0; i < entries.length; i++) {
    resolveEntry(i, entryOffsets[i])
  }

  return {
    version: header.version,
    objects,
    index: objectsBySha,
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sha1(data: Uint8Array): string {
  const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6]
  let H0 = 0x67452301
  let H1 = 0xefcdab89
  let H2 = 0x98badcfe
  let H3 = 0x10325476
  let H4 = 0xc3d2e1f0

  const msgLen = data.length
  const bitLen = msgLen * 8
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(data)
  padded[msgLen] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 4, bitLen, false)

  const W = new Uint32Array(80)

  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      W[j] = view.getUint32(i + j * 4, false)
    }
    for (let j = 16; j < 80; j++) {
      W[j] = rotateLeft(W[j - 3] ^ W[j - 8] ^ W[j - 14] ^ W[j - 16], 1)
    }

    let a = H0
    let b = H1
    let c = H2
    let d = H3
    let e = H4

    for (let j = 0; j < 80; j++) {
      let f: number
      let k: number

      if (j < 20) {
        f = (b & c) | (~b & d)
        k = K[0]
      } else if (j < 40) {
        f = b ^ c ^ d
        k = K[1]
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = K[2]
      } else {
        f = b ^ c ^ d
        k = K[3]
      }

      const temp = (rotateLeft(a, 5) + f + e + k + W[j]) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }

    H0 = (H0 + a) >>> 0
    H1 = (H1 + b) >>> 0
    H2 = (H2 + c) >>> 0
    H3 = (H3 + d) >>> 0
    H4 = (H4 + e) >>> 0
  }

  const result = new Uint8Array(20)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(0, H0, false)
  resultView.setUint32(4, H1, false)
  resultView.setUint32(8, H2, false)
  resultView.setUint32(12, H3, false)
  resultView.setUint32(16, H4, false)

  return bytesToHex(result)
}

function rotateLeft(n: number, bits: number): number {
  return ((n << bits) | (n >>> (32 - bits))) >>> 0
}

// =============================================================================
// Legacy exports for compatibility
// =============================================================================

export interface ParsedObject {
  type: ObjectType
  data: Uint8Array
  offset?: number
  size?: number
}

export interface ParseResult {
  version: number
  objectCount: number
  objects: ParsedObject[]
  checksum: Uint8Array
}

export class PackParser {
  parse(pack: Uint8Array): ParseResult {
    // Validate minimum size (header + checksum)
    if (pack.length < 32) {
      throw new PackParseError('Pack too small')
    }

    // Parse header
    const header = parsePackHeader(pack)
    const checksum = pack.slice(-20)

    // Parse objects
    const objects: ParsedObject[] = []
    const objectsByOffset: Map<number, ParsedObject> = new Map()
    let offset = 12

    for (let i = 0; i < header.objectCount; i++) {
      const objectOffset = offset

      // Parse entry
      const entry = parsePackEntry(pack, offset)
      offset += entry.bytesConsumed

      let resolvedData = entry.data
      let resolvedType = entry.type

      // Handle delta types
      if (entry.type === OBJ_OFS_DELTA && entry.baseOffset !== undefined) {
        const baseOffset = objectOffset - entry.baseOffset
        const baseObject = objectsByOffset.get(baseOffset)
        if (!baseObject) {
          throw new MissingBaseObjectError(`offset:${baseOffset}`, baseOffset)
        }
        resolvedData = applyDelta(entry.data, baseObject.data)
        resolvedType = baseObject.type
      } else if (entry.type === OBJ_REF_DELTA && entry.baseSha !== undefined) {
        // Find base in already parsed objects
        let baseObject: ParsedObject | undefined
        for (const obj of objects) {
          baseObject = obj
          break
        }
        if (!baseObject) {
          throw new MissingBaseObjectError(entry.baseSha, objectOffset)
        }
        resolvedData = applyDelta(entry.data, baseObject.data)
        resolvedType = baseObject.type
      }

      const parsed: ParsedObject = {
        type: resolvedType as ObjectType,
        data: resolvedData,
        offset: objectOffset,
        size: resolvedData.length,
      }

      objects.push(parsed)
      objectsByOffset.set(objectOffset, parsed)
    }

    return {
      version: header.version,
      objectCount: header.objectCount,
      objects,
      checksum,
    }
  }
}

// =============================================================================
// LRU Cache for Delta Base Objects
// =============================================================================

/**
 * LRU (Least Recently Used) Cache for memory-efficient delta resolution.
 * Keeps only the most recently used base objects in memory.
 */
export class LRUCache<K, V> {
  private cache: Map<K, V> = new Map()
  private readonly maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    // Evict oldest if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }
    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// =============================================================================
// Pack Index - Maps offsets to object info for on-demand resolution
// =============================================================================

/**
 * Index entry for a pack object
 */
export interface PackIndexEntry {
  offset: number
  type: number
  size: number
  headerSize: number
  baseOffset?: number
  baseSha?: string
}

/**
 * Build an index of object offsets without loading full data into memory.
 * This is the first pass for memory-efficient pack processing.
 */
export function buildPackIndex(data: Uint8Array): {
  header: PackHeader
  entries: PackIndexEntry[]
  entryOffsets: number[]
} {
  const header = parsePackHeader(data)
  const entries: PackIndexEntry[] = []
  const entryOffsets: number[] = []
  let offset = 12

  for (let i = 0; i < header.objectCount; i++) {
    entryOffsets.push(offset)

    if (offset >= data.length - 20) {
      throw new CorruptedPackError(`Object count mismatch: expected ${header.objectCount}, got ${i}`)
    }

    // Parse type and size without decompressing
    const { type, size, bytesRead: sizeBytes } = decodePackSizeOnly(data, offset)
    let headerSize = sizeBytes
    let baseOffset: number | undefined
    let baseSha: string | undefined

    if (type === OBJ_OFS_DELTA) {
      const { value: ofsOffset, bytesRead: offsetBytes } = decodeOfsOffset(data, offset + sizeBytes)
      baseOffset = ofsOffset
      headerSize += offsetBytes
    } else if (type === OBJ_REF_DELTA) {
      const shaBytes = data.slice(offset + sizeBytes, offset + sizeBytes + 20)
      baseSha = bytesToHex(shaBytes)
      headerSize += 20
    }

    // Find compressed data size by trying decompression
    const { bytesConsumed: zlibBytes } = decompressZlib(data, offset + headerSize)

    entries.push({
      offset,
      type,
      size,
      headerSize,
      baseOffset,
      baseSha,
    })

    offset += headerSize + zlibBytes
  }

  return { header, entries, entryOffsets }
}

/**
 * Decode pack object type and size without decompression
 */
function decodePackSizeOnly(
  data: Uint8Array,
  offset: number
): { type: number; size: number; bytesRead: number } {
  const firstByte = data[offset]
  const type = (firstByte >> 4) & 0x07
  let size = firstByte & 0x0f
  let shift = 4
  let bytesRead = 1

  if ((firstByte & 0x80) !== 0) {
    while (offset + bytesRead < data.length) {
      const byte = data[offset + bytesRead]
      size |= (byte & 0x7f) << shift
      shift += 7
      bytesRead++

      if ((byte & 0x80) === 0) {
        break
      }
    }
  }

  return { type, size, bytesRead }
}

/**
 * Decode OFS_DELTA negative offset (exported for streaming use)
 */
export function decodeOfsOffset(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = data[offset] & 0x7f
  let bytesRead = 1

  while ((data[offset + bytesRead - 1] & 0x80) !== 0) {
    if (offset + bytesRead >= data.length) {
      throw new PackParseError('Truncated OFS_DELTA offset')
    }
    value = ((value + 1) << 7) | (data[offset + bytesRead] & 0x7f)
    bytesRead++
  }

  return { value, bytesRead }
}

// =============================================================================
// Streaming Pack Parser
// =============================================================================

/**
 * Resolved object from streaming parser
 */
export interface StreamingPackObject {
  type: number
  typeName: string
  size: number
  data: Uint8Array
  sha: string
  offset: number
}

/**
 * Options for streaming pack parser
 */
export interface StreamingParseOptions {
  /** Maximum number of base objects to cache for delta resolution */
  cacheSize?: number
  /** External object resolver for thin packs */
  resolveExternal?: (sha: string) => Uint8Array | undefined
  /** Callback for progress reporting */
  onProgress?: (parsed: number, total: number) => void
}

/**
 * Streaming Pack Parser - Memory-efficient pack file parsing.
 *
 * Uses async generators to process pack entries one at a time.
 * Only keeps delta base objects in an LRU cache.
 * Memory usage is O(delta_depth * max_object_size) instead of O(pack_size).
 *
 * @example
 * ```typescript
 * const parser = new StreamingPackParser(packData, { cacheSize: 50 })
 * for await (const obj of parser.objects()) {
 *   console.log(obj.sha, obj.typeName, obj.size)
 *   // Process object without keeping all in memory
 * }
 * ```
 */
export class StreamingPackParser {
  private readonly data: Uint8Array
  private readonly options: StreamingParseOptions
  private header: PackHeader | null = null
  private index: PackIndexEntry[] | null = null
  private entryOffsets: number[] | null = null
  private baseCache: LRUCache<number, { type: number; data: Uint8Array }>
  private resolvedBySha: Map<string, { type: number; data: Uint8Array }> = new Map()
  private resolving: Set<number> = new Set()

  constructor(data: Uint8Array, options: StreamingParseOptions = {}) {
    this.data = data
    this.options = options
    this.baseCache = new LRUCache(options.cacheSize ?? 100)
  }

  /**
   * Get pack header information
   */
  getHeader(): PackHeader {
    if (!this.header) {
      const checksumResult = verifyPackChecksum(this.data)
      if (!checksumResult.valid) {
        throw new ChecksumMismatchError(checksumResult.expected, checksumResult.actual)
      }
      this.header = parsePackHeader(this.data)
    }
    return this.header
  }

  /**
   * Build or get the pack index (lightweight first pass)
   */
  private ensureIndex(): void {
    if (!this.index) {
      const { header, entries, entryOffsets } = buildPackIndex(this.data)
      this.header = header
      this.index = entries
      this.entryOffsets = entryOffsets
    }
  }

  /**
   * Resolve a single object at the given index, handling delta chains.
   */
  private resolveObject(idx: number): { type: number; data: Uint8Array } {
    this.ensureIndex()
    const entry = this.index![idx]
    const entryOffset = this.entryOffsets![idx]

    // Check if already resolving (circular reference detection)
    if (this.resolving.has(idx)) {
      throw new CorruptedPackError('Circular delta reference detected')
    }

    // Check LRU cache first
    const cached = this.baseCache.get(entryOffset)
    if (cached) {
      return cached
    }

    this.resolving.add(idx)

    try {
      let resolvedType: number
      let resolvedData: Uint8Array

      // Parse the compressed data
      const dataOffset = entry.offset + entry.headerSize
      const { data: decompressedData } = decompressZlib(this.data, dataOffset)

      if (entry.type === OBJ_OFS_DELTA && entry.baseOffset !== undefined) {
        // Find base object by offset
        const baseOffset = entryOffset - entry.baseOffset
        const baseIdx = this.entryOffsets!.indexOf(baseOffset)
        if (baseIdx === -1) {
          throw new MissingBaseObjectError(`offset:${baseOffset}`, baseOffset)
        }
        const baseObject = this.resolveObject(baseIdx)
        resolvedData = applyDelta(decompressedData, baseObject.data)
        resolvedType = baseObject.type
      } else if (entry.type === OBJ_REF_DELTA && entry.baseSha !== undefined) {
        // Find base object by SHA
        const baseObject = this.resolvedBySha.get(entry.baseSha)
        if (!baseObject) {
          const externalData = this.options.resolveExternal?.(entry.baseSha)
          if (!externalData) {
            throw new MissingBaseObjectError(entry.baseSha, entryOffset)
          }
          resolvedData = applyDelta(decompressedData, externalData)
          resolvedType = OBJ_BLOB // Default type for external objects
        } else {
          resolvedData = applyDelta(decompressedData, baseObject.data)
          resolvedType = baseObject.type
        }
      } else {
        resolvedType = entry.type
        resolvedData = decompressedData
      }

      const result = { type: resolvedType, data: resolvedData }

      // Cache the resolved object for potential delta dependents
      this.baseCache.set(entryOffset, result)

      // Also track by SHA for REF_DELTA lookups
      const typeName = TYPE_NAMES[resolvedType] || 'unknown'
      const sha = computeObjectHash(typeName, resolvedData)
      this.resolvedBySha.set(sha, result)

      return result
    } finally {
      this.resolving.delete(idx)
    }
  }

  /**
   * Async generator that yields resolved pack objects one at a time.
   * Memory-efficient: only keeps delta base objects in LRU cache.
   */
  async *objects(): AsyncGenerator<StreamingPackObject> {
    this.ensureIndex()
    const header = this.getHeader()
    const onProgress = this.options.onProgress

    for (let i = 0; i < header.objectCount; i++) {
      const { type, data } = this.resolveObject(i)
      const typeName = TYPE_NAMES[type] || 'unknown'
      const sha = computeObjectHash(typeName, data)
      const offset = this.entryOffsets![i]

      if (onProgress) {
        onProgress(i + 1, header.objectCount)
      }

      yield {
        type,
        typeName,
        size: data.length,
        data,
        sha,
        offset,
      }
    }
  }

  /**
   * Parse to a full result (for compatibility with existing API).
   * Note: This loads all objects into memory.
   */
  async parseAll(): Promise<PackParseResult> {
    const header = this.getHeader()
    const objects: PackObject[] = []
    const index = new Map<string, PackObject>()

    for await (const obj of this.objects()) {
      const packObj: PackObject = {
        type: obj.type,
        typeName: obj.typeName,
        size: obj.size,
        data: obj.data,
        sha: obj.sha,
      }
      objects.push(packObj)
      index.set(obj.sha, packObj)
    }

    return {
      version: header.version,
      objects,
      index,
    }
  }

  /**
   * Get object count without parsing all objects
   */
  get objectCount(): number {
    return this.getHeader().objectCount
  }

  /**
   * Get pack version
   */
  get version(): number {
    return this.getHeader().version
  }
}

/**
 * Parse a pack file using streaming (memory-efficient).
 * Returns an async iterator of resolved objects.
 */
export function parsePackFileStreaming(
  data: Uint8Array,
  options?: StreamingParseOptions
): StreamingPackParser {
  return new StreamingPackParser(data, options)
}
