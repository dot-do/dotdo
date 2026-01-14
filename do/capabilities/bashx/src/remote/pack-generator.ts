/**
 * Pack Generator - Generates Git pack files
 *
 * Implements Git pack file format v2 per Git protocol specification.
 *
 * Pack file format:
 * - Header: "PACK" (4 bytes) + version (4 bytes BE) + object count (4 bytes BE)
 * - Objects: type/size varint + compressed data (zlib deflate)
 * - Footer: SHA-1 checksum (20 bytes)
 */

import pako from 'pako'

// Object type constants (matching Git protocol)
export const OBJ_COMMIT = 1
export const OBJ_TREE = 2
export const OBJ_BLOB = 3
export const OBJ_TAG = 4
export const OBJ_OFS_DELTA = 6
export const OBJ_REF_DELTA = 7

export type ObjectType =
  | typeof OBJ_COMMIT
  | typeof OBJ_TREE
  | typeof OBJ_BLOB
  | typeof OBJ_TAG
  | typeof OBJ_OFS_DELTA
  | typeof OBJ_REF_DELTA

export interface PackObject {
  type: ObjectType
  data: Uint8Array
}

export interface PackGeneratorOptions {
  useDelta?: boolean
  preferRefDelta?: boolean
  compressionLevel?: number
  thin?: boolean
}

export interface PackResult {
  pack: Uint8Array
  checksum: Uint8Array
  objectCount: number
  packSize: number
  uncompressedSize: number
  deltaCount?: number
  objectHashes?: Uint8Array[]
}

// Valid base object types (non-delta)
const VALID_TYPES = new Set([OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG])


/**
 * Compute SHA-1 hash synchronously using a pure JS implementation.
 * This is needed because generate() is synchronous.
 * Note: An async version using crypto.subtle.digest is available but not used here.
 */
function sha1Sync(data: Uint8Array): Uint8Array {
  // SHA-1 implementation
  const H = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0])

  // Pre-process: add padding
  const msgLen = data.length
  const bitLen = BigInt(msgLen) * 8n

  // Padding: 1 bit, then zeros, then length
  const padLen = (msgLen + 9) % 64 === 0 ? 0 : 64 - ((msgLen + 9) % 64)
  const paddedLen = msgLen + 1 + padLen + 8
  const padded = new Uint8Array(paddedLen)
  padded.set(data)
  padded[msgLen] = 0x80

  // Append length as 64-bit big-endian
  const view = new DataView(padded.buffer)
  view.setBigUint64(paddedLen - 8, bitLen, false)

  // Process 64-byte blocks
  const W = new Uint32Array(80)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    // Initialize W[0..15] from block
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false)
    }

    // Extend W[16..79]
    for (let i = 16; i < 80; i++) {
      const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]
      W[i] = (x << 1) | (x >>> 31)
    }

    let [a, b, c, d, e] = H

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

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = temp
    }

    H[0] = (H[0] + a) >>> 0
    H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0
    H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0
  }

  // Convert to bytes
  const result = new Uint8Array(20)
  const resultView = new DataView(result.buffer)
  for (let i = 0; i < 5; i++) {
    resultView.setUint32(i * 4, H[i], false)
  }

  return result
}

/**
 * Compute Git object hash: SHA-1("type size\0data")
 */
function computeGitObjectHash(type: string, data: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(`${type} ${data.length}\0`)
  const combined = new Uint8Array(header.length + data.length)
  combined.set(header)
  combined.set(data, header.length)
  return sha1Sync(combined)
}

/**
 * Get type name for Git object
 */
function getTypeName(type: ObjectType): string {
  switch (type) {
    case OBJ_COMMIT:
      return 'commit'
    case OBJ_TREE:
      return 'tree'
    case OBJ_BLOB:
      return 'blob'
    case OBJ_TAG:
      return 'tag'
    default:
      return 'unknown'
  }
}

/**
 * Encode object type and size as Git pack varint.
 *
 * Format:
 * - First byte: MSB (continuation) | type (3 bits) | size (4 bits)
 * - Subsequent bytes: MSB (continuation) | size (7 bits)
 */
function encodeTypeAndSize(type: ObjectType, size: number): Uint8Array {
  const bytes: number[] = []

  // First byte: type in bits 6-4, size low 4 bits in bits 3-0
  let firstByte = (type << 4) | (size & 0x0f)
  size >>= 4

  if (size > 0) {
    firstByte |= 0x80 // Set continuation bit
  }
  bytes.push(firstByte)

  // Remaining bytes: 7 bits each
  while (size > 0) {
    let byte = size & 0x7f
    size >>= 7
    if (size > 0) {
      byte |= 0x80 // Set continuation bit
    }
    bytes.push(byte)
  }

  return new Uint8Array(bytes)
}

/**
 * Encode OFS_DELTA offset as negative varint.
 * Git uses a special encoding where each byte after the first adds 1.
 */
function encodeOfsOffset(offset: number): Uint8Array {
  const bytes: number[] = []

  // First byte
  bytes.push(offset & 0x7f)
  offset >>= 7

  // Each subsequent byte adds 1 to the value
  while (offset > 0) {
    offset -= 1
    bytes.unshift((offset & 0x7f) | 0x80)
    offset >>= 7
  }

  return new Uint8Array(bytes)
}

/**
 * Compute delta between base and derived objects.
 * Returns null if delta is not beneficial.
 */
function computeDelta(base: Uint8Array, derived: Uint8Array): Uint8Array | null {
  // Simple delta: copy instructions and insert instructions
  // For simplicity, we'll use a basic approach

  // Delta header: base size varint + derived size varint
  const deltaHeader: number[] = []

  // Encode base size
  let size = base.length
  while (size >= 128) {
    deltaHeader.push((size & 0x7f) | 0x80)
    size >>= 7
  }
  deltaHeader.push(size)

  // Encode derived size
  size = derived.length
  while (size >= 128) {
    deltaHeader.push((size & 0x7f) | 0x80)
    size >>= 7
  }
  deltaHeader.push(size)

  // Find common prefix
  let commonPrefix = 0
  while (commonPrefix < base.length && commonPrefix < derived.length && base[commonPrefix] === derived[commonPrefix]) {
    commonPrefix++
  }

  // Find common suffix (from the non-prefix parts)
  let commonSuffix = 0
  while (
    commonSuffix < base.length - commonPrefix &&
    commonSuffix < derived.length - commonPrefix &&
    base[base.length - 1 - commonSuffix] === derived[derived.length - 1 - commonSuffix]
  ) {
    commonSuffix++
  }

  // Build delta instructions
  const deltaInstructions: number[] = []

  // Copy prefix from base
  if (commonPrefix > 0) {
    // Copy instruction: MSB set, bits indicate which offset/size bytes follow
    let copyCmd = 0x80
    const copyBytes: number[] = []

    // Offset (0)
    copyBytes.push(0)
    copyCmd |= 0x01

    // Size
    const copySize = commonPrefix
    if (copySize & 0xff) {
      copyBytes.push(copySize & 0xff)
      copyCmd |= 0x10
    }
    if (copySize & 0xff00) {
      copyBytes.push((copySize >> 8) & 0xff)
      copyCmd |= 0x20
    }
    if (copySize & 0xff0000) {
      copyBytes.push((copySize >> 16) & 0xff)
      copyCmd |= 0x40
    }

    deltaInstructions.push(copyCmd, ...copyBytes)
  }

  // Insert middle part (new data)
  const middleStart = commonPrefix
  const middleEnd = derived.length - commonSuffix
  const middleData = derived.slice(middleStart, middleEnd)

  if (middleData.length > 0) {
    // Insert instruction: MSB clear, bits 0-6 are length (1-127)
    let remaining = middleData.length
    let offset = 0
    while (remaining > 0) {
      const chunkSize = Math.min(remaining, 127)
      deltaInstructions.push(chunkSize)
      for (let i = 0; i < chunkSize; i++) {
        deltaInstructions.push(middleData[offset + i])
      }
      offset += chunkSize
      remaining -= chunkSize
    }
  }

  // Copy suffix from base
  if (commonSuffix > 0) {
    let copyCmd = 0x80
    const copyBytes: number[] = []

    // Offset
    const suffixOffset = base.length - commonSuffix
    if (suffixOffset & 0xff) {
      copyBytes.push(suffixOffset & 0xff)
      copyCmd |= 0x01
    }
    if (suffixOffset & 0xff00) {
      copyBytes.push((suffixOffset >> 8) & 0xff)
      copyCmd |= 0x02
    }
    if (suffixOffset & 0xff0000) {
      copyBytes.push((suffixOffset >> 16) & 0xff)
      copyCmd |= 0x04
    }
    if (suffixOffset & 0xff000000) {
      copyBytes.push((suffixOffset >> 24) & 0xff)
      copyCmd |= 0x08
    }

    // Size
    if (commonSuffix & 0xff) {
      copyBytes.push(commonSuffix & 0xff)
      copyCmd |= 0x10
    }
    if (commonSuffix & 0xff00) {
      copyBytes.push((commonSuffix >> 8) & 0xff)
      copyCmd |= 0x20
    }
    if (commonSuffix & 0xff0000) {
      copyBytes.push((commonSuffix >> 16) & 0xff)
      copyCmd |= 0x40
    }

    deltaInstructions.push(copyCmd, ...copyBytes)
  }

  const delta = new Uint8Array([...deltaHeader, ...deltaInstructions])

  // Only use delta if it's smaller than derived
  if (delta.length >= derived.length) {
    return null
  }

  return delta
}

export class PackGenerator {
  generate(objects: PackObject[], options?: PackGeneratorOptions): PackResult {
    // Validate objects
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      if (obj === null || obj === undefined) {
        throw new Error(`Invalid object at index ${i}: null or undefined`)
      }
      if (obj.data === null || obj.data === undefined) {
        throw new Error(`Invalid object data at index ${i}: null or undefined`)
      }
      if (!VALID_TYPES.has(obj.type) && obj.type !== OBJ_OFS_DELTA && obj.type !== OBJ_REF_DELTA) {
        throw new Error(`Invalid object type: ${obj.type}`)
      }
    }

    const compressionLevel = (options?.compressionLevel ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    const useDelta = options?.useDelta ?? false
    const preferRefDelta = options?.preferRefDelta ?? false

    // Build pack data
    const chunks: Uint8Array[] = []
    let uncompressedSize = 0
    let deltaCount = 0
    const objectHashes: Uint8Array[] = []

    // Track object positions for OFS_DELTA
    const objectPositions: Map<number, number> = new Map()

    // Header will be prepended after we know the size
    // Reserve 12 bytes for header
    let currentOffset = 12

    // Process objects
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      uncompressedSize += obj.data.length

      // Compute object hash
      const typeName = getTypeName(obj.type)
      const hash = computeGitObjectHash(typeName, obj.data)
      objectHashes.push(hash)

      let objectData: Uint8Array
      let objectType: ObjectType = obj.type

      // Try delta encoding
      if (useDelta && i > 0 && objects[i - 1].type === obj.type) {
        const baseObj = objects[i - 1]
        const delta = computeDelta(baseObj.data, obj.data)

        if (delta !== null) {
          // Use OFS_DELTA or REF_DELTA
          if (preferRefDelta) {
            // REF_DELTA: include base object hash
            objectType = OBJ_REF_DELTA
            const baseHash = computeGitObjectHash(getTypeName(baseObj.type), baseObj.data)
            const refDeltaData = new Uint8Array(20 + delta.length)
            refDeltaData.set(baseHash)
            refDeltaData.set(delta, 20)
            objectData = refDeltaData
          } else {
            // OFS_DELTA: include offset to base
            objectType = OBJ_OFS_DELTA
            const basePosition = objectPositions.get(i - 1)!
            const offsetToBase = currentOffset - basePosition
            const ofsBytes = encodeOfsOffset(offsetToBase)
            const ofsDeltaData = new Uint8Array(ofsBytes.length + delta.length)
            ofsDeltaData.set(ofsBytes)
            ofsDeltaData.set(delta, ofsBytes.length)
            objectData = ofsDeltaData
          }
          deltaCount++
        } else {
          objectData = obj.data
        }
      } else {
        objectData = obj.data
      }

      // Record position for this object
      objectPositions.set(i, currentOffset)

      // Encode type and size
      const typeAndSize = encodeTypeAndSize(
        objectType,
        objectType === OBJ_OFS_DELTA || objectType === OBJ_REF_DELTA
          ? objectData.slice(objectType === OBJ_REF_DELTA ? 20 : encodeOfsOffset(1).length).length
          : obj.data.length
      )

      // For delta types, we need to handle specially
      if (objectType === OBJ_OFS_DELTA) {
        // Get the delta data (skip the temporary offset bytes we added earlier)
        const delta = objectData.slice(encodeOfsOffset(1).length)

        // Calculate actual offset from current position to base
        const basePosition = objectPositions.get(i - 1)!
        const offsetToBase = currentOffset - basePosition

        const ofsBytes = encodeOfsOffset(offsetToBase)
        const typeSizeHeader = encodeTypeAndSize(OBJ_OFS_DELTA, delta.length)

        // Compress delta data
        const compressedDelta = pako.deflate(delta, { level: compressionLevel })

        chunks.push(typeSizeHeader)
        chunks.push(ofsBytes)
        chunks.push(compressedDelta)

        currentOffset += typeSizeHeader.length + ofsBytes.length + compressedDelta.length
      } else if (objectType === OBJ_REF_DELTA) {
        const baseHash = objectData.slice(0, 20)
        const delta = objectData.slice(20)
        const typeSizeHeader = encodeTypeAndSize(OBJ_REF_DELTA, delta.length)

        // Compress delta data
        const compressedDelta = pako.deflate(delta, { level: compressionLevel })

        chunks.push(typeSizeHeader)
        chunks.push(baseHash)
        chunks.push(compressedDelta)

        currentOffset += typeSizeHeader.length + 20 + compressedDelta.length
      } else {
        // Compress object data
        const compressed = pako.deflate(obj.data, { level: compressionLevel })

        chunks.push(typeAndSize)
        chunks.push(compressed)

        currentOffset += typeAndSize.length + compressed.length
      }
    }

    // Build header
    const header = new Uint8Array(12)
    // Magic "PACK"
    header[0] = 0x50 // P
    header[1] = 0x41 // A
    header[2] = 0x43 // C
    header[3] = 0x4b // K
    // Version 2 (big-endian)
    header[4] = 0x00
    header[5] = 0x00
    header[6] = 0x00
    header[7] = 0x02
    // Object count (big-endian)
    const count = objects.length
    header[8] = (count >> 24) & 0xff
    header[9] = (count >> 16) & 0xff
    header[10] = (count >> 8) & 0xff
    header[11] = count & 0xff

    // Combine header and chunks
    const totalChunkSize = chunks.reduce((sum, c) => sum + c.length, 0)
    const packWithoutChecksum = new Uint8Array(12 + totalChunkSize)
    packWithoutChecksum.set(header)
    let offset = 12
    for (const chunk of chunks) {
      packWithoutChecksum.set(chunk, offset)
      offset += chunk.length
    }

    // Compute checksum
    const checksum = sha1Sync(packWithoutChecksum)

    // Final pack
    const pack = new Uint8Array(packWithoutChecksum.length + 20)
    pack.set(packWithoutChecksum)
    pack.set(checksum, packWithoutChecksum.length)

    return {
      pack,
      checksum,
      objectCount: objects.length,
      packSize: pack.length,
      uncompressedSize,
      deltaCount: deltaCount > 0 ? deltaCount : undefined,
      objectHashes,
    }
  }
}

// Export helper functions for tests
export { sha1Sync as computeSha1 }
export { computeGitObjectHash }

// =============================================================================
// Streaming Pack Generator
// =============================================================================

/**
 * Options for streaming pack generation
 */
export interface StreamingPackOptions extends PackGeneratorOptions {
  /** Chunk size for writing (default: 64KB) */
  chunkSize?: number
  /** Progress callback */
  onProgress?: (written: number, total: number) => void
}

/**
 * Running SHA-1 hash computation for streaming.
 * Allows incrementally adding data and computing final hash.
 */
class StreamingSha1 {
  private H = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0])
  private W = new Uint32Array(80)
  private buffer = new Uint8Array(64)
  private bufferOffset = 0
  private totalLength = 0

  update(data: Uint8Array): void {
    let dataOffset = 0
    this.totalLength += data.length

    // If we have buffered data, try to complete a block
    if (this.bufferOffset > 0) {
      const needed = 64 - this.bufferOffset
      const toCopy = Math.min(needed, data.length)
      this.buffer.set(data.slice(0, toCopy), this.bufferOffset)
      this.bufferOffset += toCopy
      dataOffset = toCopy

      if (this.bufferOffset === 64) {
        this.processBlock(this.buffer, 0)
        this.bufferOffset = 0
      }
    }

    // Process complete blocks from data
    while (dataOffset + 64 <= data.length) {
      this.processBlock(data, dataOffset)
      dataOffset += 64
    }

    // Buffer remaining data
    if (dataOffset < data.length) {
      this.buffer.set(data.slice(dataOffset), this.bufferOffset)
      this.bufferOffset += data.length - dataOffset
    }
  }

  private processBlock(data: Uint8Array, offset: number): void {
    const view = new DataView(data.buffer, data.byteOffset + offset, 64)

    // Initialize W[0..15] from block
    for (let i = 0; i < 16; i++) {
      this.W[i] = view.getUint32(i * 4, false)
    }

    // Extend W[16..79]
    for (let i = 16; i < 80; i++) {
      const x = this.W[i - 3] ^ this.W[i - 8] ^ this.W[i - 14] ^ this.W[i - 16]
      this.W[i] = (x << 1) | (x >>> 31)
    }

    let [a, b, c, d, e] = this.H

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

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + this.W[i]) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = temp
    }

    this.H[0] = (this.H[0] + a) >>> 0
    this.H[1] = (this.H[1] + b) >>> 0
    this.H[2] = (this.H[2] + c) >>> 0
    this.H[3] = (this.H[3] + d) >>> 0
    this.H[4] = (this.H[4] + e) >>> 0
  }

  finalize(): Uint8Array {
    // Add padding
    const bitLen = BigInt(this.totalLength) * 8n

    // Padding: 1 bit, then zeros, then length
    const paddingNeeded = (64 - ((this.totalLength + 9) % 64)) % 64 + 1
    const padding = new Uint8Array(paddingNeeded + 8)
    padding[0] = 0x80

    // Append length as 64-bit big-endian
    const lengthView = new DataView(padding.buffer, paddingNeeded, 8)
    lengthView.setBigUint64(0, bitLen, false)

    this.update(padding)

    // Convert to bytes
    const result = new Uint8Array(20)
    const resultView = new DataView(result.buffer)
    for (let i = 0; i < 5; i++) {
      resultView.setUint32(i * 4, this.H[i], false)
    }

    return result
  }
}

/**
 * Streaming Pack Generator - Memory-efficient pack file generation.
 *
 * Generates pack data incrementally using async generators.
 * Streams compressed data directly to output without buffering entire objects.
 *
 * @example
 * ```typescript
 * const generator = new StreamingPackGenerator()
 * for await (const chunk of generator.generate(objects)) {
 *   await writer.write(chunk)
 * }
 * ```
 */
export class StreamingPackGenerator {
  private readonly options: StreamingPackOptions

  constructor(options: StreamingPackOptions = {}) {
    this.options = options
  }

  /**
   * Generate pack data as an async generator of chunks.
   * Memory efficient: yields chunks as they're generated.
   */
  async *generate(objects: PackObject[]): AsyncGenerator<Uint8Array> {
    // Validate objects
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      if (obj === null || obj === undefined) {
        throw new Error(`Invalid object at index ${i}: null or undefined`)
      }
      if (obj.data === null || obj.data === undefined) {
        throw new Error(`Invalid object data at index ${i}: null or undefined`)
      }
      if (!VALID_TYPES.has(obj.type) && obj.type !== OBJ_OFS_DELTA && obj.type !== OBJ_REF_DELTA) {
        throw new Error(`Invalid object type: ${obj.type}`)
      }
    }

    const sha1 = new StreamingSha1()
    const compressionLevel = (this.options.compressionLevel ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    const useDelta = this.options.useDelta ?? false
    const preferRefDelta = this.options.preferRefDelta ?? false
    const onProgress = this.options.onProgress

    // Track object positions for OFS_DELTA
    const objectPositions: Map<number, number> = new Map()
    let currentOffset = 12

    // Generate and yield header
    const header = new Uint8Array(12)
    header[0] = 0x50 // P
    header[1] = 0x41 // A
    header[2] = 0x43 // C
    header[3] = 0x4b // K
    header[4] = 0x00
    header[5] = 0x00
    header[6] = 0x00
    header[7] = 0x02 // Version 2
    const count = objects.length
    header[8] = (count >> 24) & 0xff
    header[9] = (count >> 16) & 0xff
    header[10] = (count >> 8) & 0xff
    header[11] = count & 0xff

    sha1.update(header)
    yield header

    // Process and yield objects one at a time
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      let objectData: Uint8Array
      let objectType: ObjectType = obj.type

      // Try delta encoding
      if (useDelta && i > 0 && objects[i - 1].type === obj.type) {
        const baseObj = objects[i - 1]
        const delta = computeDelta(baseObj.data, obj.data)

        if (delta !== null) {
          if (preferRefDelta) {
            objectType = OBJ_REF_DELTA
            const baseHash = computeGitObjectHash(getTypeName(baseObj.type), baseObj.data)
            const refDeltaData = new Uint8Array(20 + delta.length)
            refDeltaData.set(baseHash)
            refDeltaData.set(delta, 20)
            objectData = refDeltaData
          } else {
            objectType = OBJ_OFS_DELTA
            const basePosition = objectPositions.get(i - 1)!
            const offsetToBase = currentOffset - basePosition
            const ofsBytes = encodeOfsOffset(offsetToBase)
            const ofsDeltaData = new Uint8Array(ofsBytes.length + delta.length)
            ofsDeltaData.set(ofsBytes)
            ofsDeltaData.set(delta, ofsBytes.length)
            objectData = ofsDeltaData
          }
        } else {
          objectData = obj.data
        }
      } else {
        objectData = obj.data
      }

      // Record position for this object
      objectPositions.set(i, currentOffset)

      // Generate and yield object entry
      const chunks: Uint8Array[] = []

      if (objectType === OBJ_OFS_DELTA) {
        const delta = objectData.slice(encodeOfsOffset(1).length)
        const basePosition = objectPositions.get(i - 1)!
        const offsetToBase = currentOffset - basePosition
        const ofsBytes = encodeOfsOffset(offsetToBase)
        const typeSizeHeader = encodeTypeAndSize(OBJ_OFS_DELTA, delta.length)
        const compressedDelta = pako.deflate(delta, { level: compressionLevel })

        chunks.push(typeSizeHeader, ofsBytes, compressedDelta)
        currentOffset += typeSizeHeader.length + ofsBytes.length + compressedDelta.length
      } else if (objectType === OBJ_REF_DELTA) {
        const baseHash = objectData.slice(0, 20)
        const delta = objectData.slice(20)
        const typeSizeHeader = encodeTypeAndSize(OBJ_REF_DELTA, delta.length)
        const compressedDelta = pako.deflate(delta, { level: compressionLevel })

        chunks.push(typeSizeHeader, baseHash, compressedDelta)
        currentOffset += typeSizeHeader.length + 20 + compressedDelta.length
      } else {
        const typeAndSize = encodeTypeAndSize(objectType, obj.data.length)
        const compressed = pako.deflate(obj.data, { level: compressionLevel })

        chunks.push(typeAndSize, compressed)
        currentOffset += typeAndSize.length + compressed.length
      }

      // Yield object chunks
      for (const chunk of chunks) {
        sha1.update(chunk)
        yield chunk
      }

      if (onProgress) {
        onProgress(i + 1, objects.length)
      }
    }

    // Generate and yield checksum
    const checksum = sha1.finalize()
    yield checksum
  }

  /**
   * Write pack directly to a WritableStream.
   * Most memory-efficient option for large packs.
   */
  async writeTo(stream: WritableStream<Uint8Array>, objects: PackObject[]): Promise<PackResult> {
    const writer = stream.getWriter()
    let totalSize = 0
    let uncompressedSize = 0

    try {
      for await (const chunk of this.generate(objects)) {
        await writer.write(chunk)
        totalSize += chunk.length
      }

      for (const obj of objects) {
        uncompressedSize += obj.data.length
      }

      // Calculate checksum from the last 20 bytes we would have written
      // For the result, we need to regenerate it
      const lastChunks: Uint8Array[] = []
      for await (const chunk of this.generate(objects)) {
        lastChunks.push(chunk)
      }
      const checksum = lastChunks[lastChunks.length - 1]

      return {
        pack: new Uint8Array(0), // Pack was written to stream
        checksum,
        objectCount: objects.length,
        packSize: totalSize,
        uncompressedSize,
      }
    } finally {
      writer.releaseLock()
    }
  }

  /**
   * Generate pack and collect all chunks into a single Uint8Array.
   * Convenience method when streaming is not needed.
   */
  async generateFull(objects: PackObject[]): Promise<PackResult> {
    const chunks: Uint8Array[] = []
    let totalSize = 0
    let uncompressedSize = 0

    for await (const chunk of this.generate(objects)) {
      chunks.push(chunk)
      totalSize += chunk.length
    }

    for (const obj of objects) {
      uncompressedSize += obj.data.length
    }

    // Combine all chunks
    const pack = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      pack.set(chunk, offset)
      offset += chunk.length
    }

    const checksum = pack.slice(-20)

    return {
      pack,
      checksum,
      objectCount: objects.length,
      packSize: totalSize,
      uncompressedSize,
    }
  }
}
