/**
 * @fileoverview Git Delta Compression Implementation
 *
 * This module implements Git's delta compression format used in pack files.
 * Delta encoding allows storing objects as differences from a base object,
 * significantly reducing storage and transfer sizes.
 *
 * Delta format:
 * - Header: source size (varint), target size (varint)
 * - Instructions: sequence of copy/insert operations
 *
 * Copy instruction (MSB set):
 *   First byte: 1OOOOSSS where O = offset bytes present, S = size bytes present
 *   Following bytes: offset (little-endian), size (little-endian)
 *
 * Insert instruction (MSB clear):
 *   First byte: 0SSSSSSS where S = size (1-127)
 *   Following bytes: literal data to insert
 */

// =============================================================================
// Types
// =============================================================================

/** Delta instruction types */
export interface CopyInstruction {
  type: 'copy'
  offset: number
  size: number
}

export interface InsertInstruction {
  type: 'insert'
  data: Uint8Array
}

export type DeltaInstruction = CopyInstruction | InsertInstruction

/** Delta header containing source and target sizes */
export interface DeltaHeader {
  sourceSize: number
  targetSize: number
  bytesRead: number
}

/** OFS_DELTA header (negative offset to base in same pack) */
export interface OfsDeltaHeader {
  offset: number
  bytesRead: number
}

/** REF_DELTA header (SHA reference to base object) */
export interface RefDeltaHeader {
  sha: Uint8Array
  shaHex?: string
  bytesRead: number
}

// =============================================================================
// Constants
// =============================================================================

/** Copy instruction marker (MSB set) */
export const COPY_INSTRUCTION = 0x80

/** Insert instruction marker (MSB clear) */
export const INSERT_INSTRUCTION = 0x00

/** OFS_DELTA object type in pack file */
export const OFS_DELTA = 6

/** REF_DELTA object type in pack file */
export const REF_DELTA = 7

/** Maximum varint bytes to prevent infinite loops */
const MAX_VARINT_BYTES = 10

// =============================================================================
// Delta Header Encoding/Decoding (Varints)
// =============================================================================

/**
 * Parse a delta header size (varint format).
 * Each byte has 7 data bits and 1 continuation bit (MSB).
 * Uses multiplication instead of bit shifts to support large numbers.
 */
export function parseDeltaHeader(
  data: Uint8Array,
  offset: number
): { size: number; bytesRead: number } {
  let size = 0
  let multiplier = 1
  let bytesRead = 0

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new Error('Truncated varint in delta header')
    }

    const byte = data[offset + bytesRead]
    bytesRead++

    size += (byte & 0x7f) * multiplier
    multiplier *= 128

    if ((byte & 0x80) === 0) {
      break
    }

    if (bytesRead >= MAX_VARINT_BYTES) {
      throw new Error('Varint too long - possible corruption')
    }
  }

  return { size, bytesRead }
}

/**
 * Encode a size value as a varint for delta header.
 */
export function encodeDeltaHeader(size: number): Uint8Array {
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

// =============================================================================
// Copy Instruction Encoding/Decoding
// =============================================================================

/**
 * Encode a copy instruction.
 *
 * Format:
 * - First byte: 1OOOO SSS
 *   - Bit 7: always 1 (copy marker)
 *   - Bits 0-3: which offset bytes are present
 *   - Bits 4-6: which size bytes are present
 * - Following bytes: offset bytes (little-endian, only non-zero)
 * - Then: size bytes (little-endian, only non-zero)
 *
 * Special case: if size is 0x10000, no size bytes are written.
 */
export function encodeCopyInstruction(offset: number, size: number): Uint8Array {
  const bytes: number[] = []
  let cmd = COPY_INSTRUCTION

  // Encode offset bytes (4 possible bytes, little-endian)
  const offsetBytes: number[] = []
  if ((offset & 0xff) !== 0) {
    cmd |= 0x01
    offsetBytes.push(offset & 0xff)
  }
  if ((offset & 0xff00) !== 0) {
    cmd |= 0x02
    offsetBytes.push((offset >> 8) & 0xff)
  }
  if ((offset & 0xff0000) !== 0) {
    cmd |= 0x04
    offsetBytes.push((offset >> 16) & 0xff)
  }
  if ((offset & 0xff000000) !== 0) {
    cmd |= 0x08
    offsetBytes.push((offset >> 24) & 0xff)
  }

  // Encode size bytes (3 possible bytes, little-endian)
  // Special: size of 0x10000 is encoded as no size bytes
  const sizeBytes: number[] = []
  const actualSize = size === 0x10000 ? 0 : size

  if ((actualSize & 0xff) !== 0) {
    cmd |= 0x10
    sizeBytes.push(actualSize & 0xff)
  }
  if ((actualSize & 0xff00) !== 0) {
    cmd |= 0x20
    sizeBytes.push((actualSize >> 8) & 0xff)
  }
  if ((actualSize & 0xff0000) !== 0) {
    cmd |= 0x40
    sizeBytes.push((actualSize >> 16) & 0xff)
  }

  bytes.push(cmd)
  bytes.push(...offsetBytes)
  bytes.push(...sizeBytes)

  return new Uint8Array(bytes)
}

/**
 * Decode a copy instruction from delta data.
 */
export function decodeCopyInstruction(
  data: Uint8Array,
  pos: number
): { offset: number; size: number; bytesRead: number } {
  const cmd = data[pos]
  let bytesRead = 1

  // Decode offset (little-endian, bytes selected by bits 0-3)
  let offset = 0
  if (cmd & 0x01) {
    offset |= data[pos + bytesRead++]
  }
  if (cmd & 0x02) {
    offset |= data[pos + bytesRead++] << 8
  }
  if (cmd & 0x04) {
    offset |= data[pos + bytesRead++] << 16
  }
  if (cmd & 0x08) {
    offset |= data[pos + bytesRead++] << 24
  }
  // Handle unsigned 32-bit
  offset = offset >>> 0

  // Decode size (little-endian, bytes selected by bits 4-6)
  let size = 0
  if (cmd & 0x10) {
    size |= data[pos + bytesRead++]
  }
  if (cmd & 0x20) {
    size |= data[pos + bytesRead++] << 8
  }
  if (cmd & 0x40) {
    size |= data[pos + bytesRead++] << 16
  }

  // Size of 0 means 0x10000
  if (size === 0) {
    size = 0x10000
  }

  return { offset, size, bytesRead }
}

// =============================================================================
// Insert Instruction Encoding/Decoding
// =============================================================================

/**
 * Encode an insert instruction.
 * Inserts larger than 127 bytes are split into multiple instructions.
 */
export function encodeInsertInstruction(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    throw new Error('Cannot encode empty insert instruction')
  }

  const chunks: Uint8Array[] = []
  let remaining = data.length
  let offset = 0

  while (remaining > 0) {
    const chunkSize = Math.min(remaining, 127)
    const chunk = new Uint8Array(1 + chunkSize)
    chunk[0] = chunkSize
    chunk.set(data.subarray(offset, offset + chunkSize), 1)
    chunks.push(chunk)
    offset += chunkSize
    remaining -= chunkSize
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(totalLength)
  let pos = 0
  for (const chunk of chunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }

  return result
}

/**
 * Decode an insert instruction from delta data.
 */
export function decodeInsertInstruction(
  data: Uint8Array,
  pos: number
): { size: number; data: Uint8Array; bytesRead: number } {
  const size = data[pos] & 0x7f

  if (pos + 1 + size > data.length) {
    throw new Error('Truncated insert instruction data')
  }

  return {
    size,
    data: data.slice(pos + 1, pos + 1 + size),
    bytesRead: 1 + size,
  }
}

// =============================================================================
// Delta Application
// =============================================================================

/**
 * Apply a delta to a base object to produce the target object.
 */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let pos = 0

  // Parse source size header
  const sourceHeader = parseDeltaHeader(delta, pos)
  pos += sourceHeader.bytesRead

  if (sourceHeader.size !== base.length) {
    throw new Error(
      `Source size mismatch: expected ${sourceHeader.size}, got ${base.length}`
    )
  }

  // Parse target size header
  const targetHeader = parseDeltaHeader(delta, pos)
  pos += targetHeader.bytesRead

  const target = new Uint8Array(targetHeader.size)
  let targetPos = 0

  // Process instructions
  while (pos < delta.length) {
    const cmd = delta[pos]

    if (cmd === 0) {
      throw new Error('Invalid delta instruction: reserved opcode 0x00')
    }

    if (cmd & COPY_INSTRUCTION) {
      // Copy instruction
      const { offset, size, bytesRead } = decodeCopyInstruction(delta, pos)
      pos += bytesRead

      if (offset + size > base.length) {
        throw new Error(
          `Copy out of bounds: offset=${offset}, size=${size}, base.length=${base.length}`
        )
      }

      target.set(base.subarray(offset, offset + size), targetPos)
      targetPos += size
    } else {
      // Insert instruction
      const { data, bytesRead } = decodeInsertInstruction(delta, pos)
      pos += bytesRead

      target.set(data, targetPos)
      targetPos += data.length
    }
  }

  if (targetPos !== targetHeader.size) {
    throw new Error(
      `Target size mismatch: expected ${targetHeader.size}, produced ${targetPos}`
    )
  }

  return target
}

/**
 * Apply a chain of deltas to a base object.
 */
export function applyDeltaChain(
  base: Uint8Array,
  deltas: Uint8Array[]
): Uint8Array {
  let result = base

  for (const delta of deltas) {
    result = applyDelta(result, delta)
  }

  return result
}

// =============================================================================
// Delta Creation
// =============================================================================

/**
 * Create a delta that transforms base into target.
 *
 * This uses a simple sliding window algorithm to find matching sequences.
 * More sophisticated implementations would use hash-based matching.
 */
export function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
  const instructions: Uint8Array[] = []

  // Add headers
  instructions.push(encodeDeltaHeader(base.length))
  instructions.push(encodeDeltaHeader(target.length))

  // Empty target - just return headers
  if (target.length === 0) {
    return concatArrays(instructions)
  }

  // Empty base - insert everything
  if (base.length === 0) {
    instructions.push(encodeInsertInstruction(target))
    return concatArrays(instructions)
  }

  // Build index of base for fast matching
  const index = buildMatchIndex(base)

  let targetPos = 0

  while (targetPos < target.length) {
    // Try to find a match in the base
    const match = findMatch(base, target, targetPos, index)

    if (match && match.length >= 4) {
      // Found a good match - emit copy instruction
      instructions.push(encodeCopyInstruction(match.offset, match.length))
      targetPos += match.length
    } else {
      // No good match - find how much to insert
      let insertEnd = targetPos + 1

      while (insertEnd < target.length) {
        const nextMatch = findMatch(base, target, insertEnd, index)
        if (nextMatch && nextMatch.length >= 4) {
          break
        }
        insertEnd++
      }

      // Emit insert instruction(s)
      instructions.push(
        encodeInsertInstruction(target.subarray(targetPos, insertEnd))
      )
      targetPos = insertEnd
    }
  }

  return concatArrays(instructions)
}

/**
 * Build an index for fast match finding.
 * Maps 4-byte sequences to their positions in the base.
 */
function buildMatchIndex(base: Uint8Array): Map<number, number[]> {
  const index = new Map<number, number[]>()

  for (let i = 0; i <= base.length - 4; i++) {
    const key =
      (base[i] << 24) | (base[i + 1] << 16) | (base[i + 2] << 8) | base[i + 3]
    const positions = index.get(key) || []
    positions.push(i)
    index.set(key, positions)
  }

  return index
}

/**
 * Find the best match for target[targetPos:] in base.
 */
function findMatch(
  base: Uint8Array,
  target: Uint8Array,
  targetPos: number,
  index: Map<number, number[]>
): { offset: number; length: number } | null {
  if (targetPos + 4 > target.length) {
    return null
  }

  const key =
    (target[targetPos] << 24) |
    (target[targetPos + 1] << 16) |
    (target[targetPos + 2] << 8) |
    target[targetPos + 3]

  const positions = index.get(key)
  if (!positions) {
    return null
  }

  let bestOffset = 0
  let bestLength = 0

  for (const offset of positions) {
    let length = 0
    while (
      targetPos + length < target.length &&
      offset + length < base.length &&
      base[offset + length] === target[targetPos + length] &&
      length < 0xffffff // Max copy size
    ) {
      length++
    }

    if (length > bestLength) {
      bestLength = length
      bestOffset = offset
    }
  }

  return bestLength >= 4 ? { offset: bestOffset, length: bestLength } : null
}

// =============================================================================
// OFS_DELTA Encoding/Decoding
// =============================================================================

/**
 * Encode an OFS_DELTA offset (negative offset encoding).
 *
 * The encoding uses a variable-length format where:
 * - First byte: 7 data bits, MSB indicates continuation
 * - Each subsequent byte contributes 7 bits to the value
 * - Value is accumulated as: (prev + 1) << 7 | next
 */
export function encodeOfsDelta(offset: number): Uint8Array {
  if (offset <= 0) {
    throw new Error('OFS_DELTA offset must be positive')
  }

  const bytes: number[] = []
  let value = offset

  // First byte (lowest 7 bits, no adjustment needed)
  bytes.unshift(value & 0x7f)
  value = Math.floor(value / 128)

  // Subsequent bytes need special encoding
  while (value > 0) {
    value-- // Subtract 1 before each shift
    bytes.unshift(0x80 | (value & 0x7f))
    value = Math.floor(value / 128)
  }

  return new Uint8Array(bytes)
}

/**
 * Decode an OFS_DELTA offset.
 */
export function decodeOfsDelta(
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

// =============================================================================
// REF_DELTA Encoding/Decoding
// =============================================================================

/**
 * Encode a REF_DELTA reference.
 */
export function encodeRefDelta(
  sha: Uint8Array,
  algorithm: 'sha1' | 'sha256' = 'sha1'
): Uint8Array {
  const expectedLength = algorithm === 'sha256' ? 32 : 20

  if (sha.length !== expectedLength) {
    throw new Error(`REF_DELTA SHA must be ${expectedLength} bytes`)
  }

  return new Uint8Array(sha)
}

/**
 * Decode a REF_DELTA reference.
 */
export function decodeRefDelta(
  data: Uint8Array,
  pos: number,
  options?: { asHex?: boolean; algorithm?: 'sha1' | 'sha256' }
): RefDeltaHeader {
  const length = options?.algorithm === 'sha256' ? 32 : 20

  if (pos + length > data.length) {
    throw new Error('Truncated REF_DELTA SHA')
  }

  const sha = data.slice(pos, pos + length)
  const result: RefDeltaHeader = {
    sha,
    bytesRead: length,
  }

  if (options?.asHex) {
    result.shaHex = Array.from(sha)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  return result
}

// =============================================================================
// Helpers
// =============================================================================

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
