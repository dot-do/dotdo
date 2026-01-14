/**
 * @fileoverview Git Pack Format Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core pack module with backward compatibility layer.
 *
 * @module @dotdo/gitx/pack
 */

// Re-export everything from the core pack module
export {
  // Constants
  PACK_MAGIC,
  PACK_VERSION,
  PACK_INDEX_MAGIC,
  PACK_INDEX_VERSION_2,
  LARGE_OFFSET_THRESHOLD,

  // Pack object types
  PackObjectType,
  OBJ_COMMIT,
  OBJ_TREE,
  OBJ_BLOB,
  OBJ_TAG,
  OBJ_OFS_DELTA,
  OBJ_REF_DELTA,

  // Types
  type PackHeader,
  type PackIndexEntry,
  type FanoutTable,
  type PackIndex,
  type ParsedPackObject,

  // Pack header operations
  parsePackHeader,
  createPackHeader,
  validatePackHeader,

  // Object header encoding/decoding
  encodeVariableLengthSize,
  decodeVariableLengthSize,
  encodeObjectHeader,
  decodeObjectHeader,

  // Pack checksum
  computePackChecksum,
  verifyPackChecksum,

  // Fanout table operations
  parseFanoutTable,
  createFanoutTable,
  getFanoutRange,

  // Pack index operations
  parsePackIndex,
  createPackIndex,
  serializePackIndex,
  lookupObjectInIndex,

  // CRC32 calculation
  calculateCRC32,

  // Large offset handling
  isLargeOffset,
  readLargeOffset,
  writeLargeOffset,

  // Delta offset encoding
  parseDeltaOffset,
  encodeDeltaOffset,

  // Pack parser and writer
  PackParser,
  PackObjectIterator,
  PackWriter,

  // Delta operations (from delta.ts)
  applyDelta,
  createDelta,
  parseDeltaHeader,
  encodeDeltaHeader,
  type DeltaInstruction,
  type DeltaHeader,
  encodeCopyInstruction,
  decodeCopyInstruction,
  encodeInsertInstruction,
  decodeInsertInstruction,
  applyDeltaChain,
  encodeOfsDelta,
  decodeOfsDelta,
  encodeRefDelta,
  decodeRefDelta,
} from '../../core/pack'

// Import types for ObjectType from objects
import type { ObjectType } from './objects'

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * Type of entry in a pack file.
 * @deprecated Use PackObjectType enum from core/pack
 */
export type PackEntryType =
  | 'commit'
  | 'tree'
  | 'blob'
  | 'tag'
  | 'ofs_delta'
  | 'ref_delta'

/**
 * A single entry in a pack file.
 * @deprecated Use ParsedPackObject from core/pack
 */
export interface PackEntry {
  type: PackEntryType
  size: number
  offset: number
  baseOffset?: number
  baseSha?: string
  data?: Uint8Array
}

/**
 * Delta instruction types.
 */
export type DeltaInstructionType = 'copy' | 'insert'

/**
 * Parsed delta data.
 */
export interface ParsedDelta {
  baseSize: number
  resultSize: number
  instructions: LegacyDeltaInstruction[]
}

/**
 * A delta instruction (legacy format).
 */
export interface LegacyDeltaInstruction {
  type: DeltaInstructionType
  offset?: number
  length?: number
  data?: Uint8Array
}

// ============================================================================
// Legacy Constants
// ============================================================================

/**
 * Pack file signature bytes.
 */
export const PACK_SIGNATURE = new Uint8Array([0x50, 0x41, 0x43, 0x4b]) // 'PACK'

/**
 * Pack index signature bytes (v2).
 */
export const PACK_IDX_SIGNATURE = new Uint8Array([0xff, 0x74, 0x4f, 0x63]) // '\377tOc'

/**
 * Pack entry type numbers (3-bit encoding).
 */
export const PACK_TYPE_NUMBERS = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
  ofs_delta: 6,
  ref_delta: 7,
} as const

/**
 * Reverse mapping from type number to type name.
 */
export const PACK_NUMBER_TO_TYPE: Record<number, PackEntryType> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
  6: 'ofs_delta',
  7: 'ref_delta',
}

// ============================================================================
// Legacy Utility Functions
// ============================================================================

/**
 * Check if a pack entry type is a delta type.
 */
export function isDeltaType(type: PackEntryType): type is 'ofs_delta' | 'ref_delta' {
  return type === 'ofs_delta' || type === 'ref_delta'
}

/**
 * Check if a pack entry type is a base object type.
 */
export function isBaseType(type: PackEntryType): type is ObjectType {
  return type === 'commit' || type === 'tree' || type === 'blob' || type === 'tag'
}

/**
 * Get the pack type number for an object type.
 */
export function getPackTypeNumber(type: PackEntryType): number {
  return PACK_TYPE_NUMBERS[type]
}

/**
 * Get the pack entry type from a type number.
 */
export function getPackEntryType(num: number): PackEntryType | null {
  return PACK_NUMBER_TO_TYPE[num] ?? null
}

/**
 * Read a variable-length size from pack format.
 */
export function readPackSize(data: Uint8Array, offset: number): { type: number; size: number; newOffset: number } {
  let byte = data[offset++]
  const type = (byte >> 4) & 0x07
  let size = byte & 0x0f
  let shift = 4

  while (byte & 0x80) {
    byte = data[offset++]
    size |= (byte & 0x7f) << shift
    shift += 7
  }

  return { type, size, newOffset: offset }
}

/**
 * Read a variable-length offset for OFS_DELTA.
 */
export function readDeltaOffset(data: Uint8Array, offset: number): { deltaOffset: number; newOffset: number } {
  let byte = data[offset++]
  let deltaOffset = byte & 0x7f

  while (byte & 0x80) {
    deltaOffset += 1
    byte = data[offset++]
    deltaOffset = (deltaOffset << 7) | (byte & 0x7f)
  }

  return { deltaOffset, newOffset: offset }
}

/**
 * Read a variable-length integer from delta data.
 */
export function readDeltaSize(data: Uint8Array, offset: number): { size: number; newOffset: number } {
  let size = 0
  let shift = 0
  let byte: number

  do {
    byte = data[offset++]
    size |= (byte & 0x7f) << shift
    shift += 7
  } while (byte & 0x80)

  return { size, newOffset: offset }
}

/**
 * Parse delta instructions from delta data.
 */
export function parseDeltaInstructions(data: Uint8Array): ParsedDelta {
  let offset = 0

  const { size: baseSize, newOffset: offset1 } = readDeltaSize(data, offset)
  offset = offset1

  const { size: resultSize, newOffset: offset2 } = readDeltaSize(data, offset)
  offset = offset2

  const instructions: LegacyDeltaInstruction[] = []

  while (offset < data.length) {
    const cmd = data[offset++]

    if (cmd & 0x80) {
      let copyOffset = 0
      let copySize = 0

      if (cmd & 0x01) copyOffset = data[offset++]
      if (cmd & 0x02) copyOffset |= data[offset++] << 8
      if (cmd & 0x04) copyOffset |= data[offset++] << 16
      if (cmd & 0x08) copyOffset |= data[offset++] << 24

      if (cmd & 0x10) copySize = data[offset++]
      if (cmd & 0x20) copySize |= data[offset++] << 8
      if (cmd & 0x40) copySize |= data[offset++] << 16

      if (copySize === 0) copySize = 0x10000

      instructions.push({
        type: 'copy',
        offset: copyOffset,
        length: copySize,
      })
    } else if (cmd > 0) {
      const insertData = data.slice(offset, offset + cmd)
      offset += cmd

      instructions.push({
        type: 'insert',
        data: insertData,
        length: cmd,
      })
    } else {
      throw new Error('Invalid delta instruction: cmd byte is 0')
    }
  }

  return { baseSize, resultSize, instructions }
}

/**
 * Apply delta instructions to a base object (legacy API).
 * @deprecated Use applyDelta from core/pack/delta instead
 */
export function applyDeltaLegacy(base: Uint8Array, delta: ParsedDelta): Uint8Array {
  if (base.length !== delta.baseSize) {
    throw new Error(`Base size mismatch: expected ${delta.baseSize}, got ${base.length}`)
  }

  const result = new Uint8Array(delta.resultSize)
  let resultOffset = 0

  for (const instruction of delta.instructions) {
    if (instruction.type === 'copy') {
      const src = base.subarray(instruction.offset!, instruction.offset! + instruction.length!)
      result.set(src, resultOffset)
      resultOffset += instruction.length!
    } else {
      result.set(instruction.data!, resultOffset)
      resultOffset += instruction.data!.length
    }
  }

  if (resultOffset !== delta.resultSize) {
    throw new Error(`Result size mismatch: expected ${delta.resultSize}, got ${resultOffset}`)
  }

  return result
}
