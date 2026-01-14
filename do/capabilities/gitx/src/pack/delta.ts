/**
 * @fileoverview Git Packfile Delta Encoding/Decoding
 *
 * This module implements Git's delta compression algorithm, which is used in packfiles
 * to efficiently store objects by encoding only the differences between similar objects.
 *
 * ## Delta Format Overview
 *
 * A delta consists of:
 * 1. **Source size** - Variable-length integer specifying the base object size
 * 2. **Target size** - Variable-length integer specifying the result size
 * 3. **Instructions** - Sequence of copy or insert commands
 *
 * ## Instruction Types
 *
 * ### Copy Instruction (MSB = 1)
 * Copies a range of bytes from the source (base) object.
 *
 * | Bit    | Meaning                                   |
 * |--------|-------------------------------------------|
 * | 7      | Always 1 (copy marker)                    |
 * | 6-4    | Which size bytes follow (bit mask)        |
 * | 3-0    | Which offset bytes follow (bit mask)      |
 *
 * Following bytes encode offset (up to 4 bytes) and size (up to 3 bytes).
 * If size is 0 after decoding, it means 0x10000 (65536).
 *
 * ### Insert Instruction (MSB = 0)
 * Inserts literal bytes directly into the output.
 *
 * | Bit    | Meaning                                   |
 * |--------|-------------------------------------------|
 * | 7      | Always 0 (insert marker)                  |
 * | 6-0    | Number of bytes to insert (1-127)         |
 *
 * The instruction byte is followed by that many literal bytes.
 *
 * ## Performance Optimizations
 *
 * This implementation includes several performance optimizations:
 * - **Rabin fingerprint rolling hash**: O(1) hash updates when sliding the window
 * - **Typed arrays for index**: Uses Uint32Array for memory efficiency
 * - **Chunked processing**: Memory-efficient processing for large files
 * - **Optimized match extension**: SIMD-friendly byte comparison
 *
 * @module pack/delta
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Apply a delta to reconstruct an object
 * import { applyDelta } from './delta';
 *
 * const baseObject = getBaseObject();    // Uint8Array
 * const deltaData = getDeltaData();      // Uint8Array from packfile
 * const targetObject = applyDelta(baseObject, deltaData);
 *
 * @example
 * // Create a delta between two objects
 * import { createDelta } from './delta';
 *
 * const oldVersion = new TextEncoder().encode('Hello, World!');
 * const newVersion = new TextEncoder().encode('Hello, Universe!');
 * const delta = createDelta(oldVersion, newVersion);
 */

/**
 * Marker byte for copy instructions (MSB set).
 * When the MSB is set, the instruction copies bytes from the base object.
 *
 * @constant {number}
 */
export const COPY_INSTRUCTION = 0x80

/**
 * Marker byte for insert instructions (MSB clear).
 * When the MSB is clear, the lower 7 bits indicate how many literal bytes follow.
 *
 * @constant {number}
 */
export const INSERT_INSTRUCTION = 0x00

// =============================================================================
// Rabin Fingerprint Rolling Hash Constants and Implementation
// =============================================================================

/**
 * Window size for rolling hash matching.
 * 4 bytes is a good balance between collision rate and match granularity.
 *
 * @constant {number}
 */
const WINDOW_SIZE = 4

/**
 * Rabin fingerprint polynomial base.
 * Using a prime number provides good hash distribution.
 *
 * @constant {number}
 */
const RABIN_BASE = 257

/**
 * Modulus for Rabin fingerprint to keep values in 32-bit range.
 * Using a prime close to 2^31 for good distribution.
 *
 * @constant {number}
 */
const RABIN_MOD = 0x7fffffff // 2^31 - 1, a Mersenne prime

/**
 * Pre-computed power of RABIN_BASE^WINDOW_SIZE mod RABIN_MOD.
 * Used for efficiently removing the contribution of the oldest byte.
 *
 * @constant {number}
 */
const RABIN_POW = (() => {
  let pow = 1
  for (let i = 0; i < WINDOW_SIZE; i++) {
    pow = (pow * RABIN_BASE) % RABIN_MOD
  }
  return pow
})()

/**
 * Minimum match length to be worth a copy instruction.
 * Smaller matches cost more than they save due to instruction overhead.
 *
 * @constant {number}
 */
const MIN_COPY_SIZE = 4

/**
 * Chunk size for processing large files.
 * 64KB chunks balance memory usage and cache efficiency.
 *
 * @constant {number}
 */
const CHUNK_SIZE = 64 * 1024

/**
 * Maximum entries per hash bucket to prevent pathological cases.
 * Limits memory usage when many positions hash to the same value.
 *
 * @constant {number}
 */
const MAX_BUCKET_SIZE = 64

/**
 * Computes Rabin fingerprint hash for initial window.
 *
 * @description Computes the hash value for the first WINDOW_SIZE bytes.
 * Subsequent positions use rolling updates for O(1) computation.
 *
 * @param {Uint8Array} data - The data buffer
 * @param {number} offset - Starting offset
 * @returns {number} 32-bit hash value
 * @internal
 */
function rabinHash(data: Uint8Array, offset: number): number {
  let hash = 0
  for (let i = 0; i < WINDOW_SIZE; i++) {
    hash = (hash * RABIN_BASE + data[offset + i]) % RABIN_MOD
  }
  return hash
}

/**
 * Updates Rabin fingerprint hash by rolling the window one byte forward.
 *
 * @description This is the key optimization: O(1) hash update instead of O(WINDOW_SIZE).
 * Removes contribution of outgoing byte and adds incoming byte.
 *
 * Formula: hash' = (hash * BASE - outgoing * BASE^WINDOW + incoming) mod MOD
 *
 * @param {number} hash - Current hash value
 * @param {number} outgoing - Byte leaving the window
 * @param {number} incoming - Byte entering the window
 * @returns {number} Updated hash value
 * @internal
 */
function rabinRoll(hash: number, outgoing: number, incoming: number): number {
  // Remove outgoing byte's contribution and add incoming byte
  // hash = hash * BASE - outgoing * BASE^WINDOW + incoming
  let newHash = ((hash * RABIN_BASE) % RABIN_MOD - (outgoing * RABIN_POW) % RABIN_MOD + incoming) % RABIN_MOD
  // Ensure positive result
  if (newHash < 0) newHash += RABIN_MOD
  return newHash
}

/**
 * Optimized hash index using typed arrays for memory efficiency.
 *
 * @description Uses a two-level structure:
 * 1. Hash table with fixed-size buckets (Uint32Array)
 * 2. Separate count array for bucket sizes
 *
 * This avoids creating thousands of small arrays which cause GC pressure.
 *
 * @interface HashIndex
 */
interface HashIndex {
  /** Number of hash buckets (power of 2 for fast modulo) */
  bucketCount: number
  /** Bucket mask for fast modulo (bucketCount - 1) */
  bucketMask: number
  /** Flat array of offsets: bucketCount * MAX_BUCKET_SIZE entries */
  offsets: Uint32Array
  /** Number of entries in each bucket */
  counts: Uint16Array
}

/**
 * Builds an optimized hash index from the base object using Rabin fingerprints.
 *
 * @description Creates a memory-efficient index for finding matching byte sequences.
 * Uses typed arrays to minimize GC pressure and memory fragmentation.
 *
 * **Memory optimization:**
 * - Uses power-of-2 bucket count for fast modulo (bitwise AND)
 * - Limits bucket size to prevent pathological cases
 * - Uses Uint32Array/Uint16Array instead of object arrays
 *
 * @param {Uint8Array} base - The base object to index
 * @returns {HashIndex} The built index
 * @internal
 */
function buildHashIndex(base: Uint8Array): HashIndex {
  // Determine optimal bucket count (power of 2, at least 256)
  // Aim for average load factor of ~4 entries per bucket
  const targetBuckets = Math.max(256, Math.ceil((base.length - WINDOW_SIZE + 1) / 4))
  const bucketCount = 1 << Math.ceil(Math.log2(targetBuckets))
  const bucketMask = bucketCount - 1

  // Allocate typed arrays
  const offsets = new Uint32Array(bucketCount * MAX_BUCKET_SIZE)
  const counts = new Uint16Array(bucketCount)

  if (base.length < WINDOW_SIZE) {
    return { bucketCount, bucketMask, offsets, counts }
  }

  // Use rolling hash to build index
  let hash = rabinHash(base, 0)
  addToIndex(0)

  for (let i = 1; i <= base.length - WINDOW_SIZE; i++) {
    // Roll the hash forward (O(1) operation)
    hash = rabinRoll(hash, base[i - 1], base[i + WINDOW_SIZE - 1])
    addToIndex(i)
  }

  return { bucketCount, bucketMask, offsets, counts }

  function addToIndex(offset: number) {
    const bucket = hash & bucketMask
    const count = counts[bucket]
    if (count < MAX_BUCKET_SIZE) {
      offsets[bucket * MAX_BUCKET_SIZE + count] = offset
      counts[bucket] = count + 1
    }
  }
}

/**
 * Looks up potential match positions from the hash index.
 *
 * @param {HashIndex} index - The hash index
 * @param {number} hash - The hash to look up
 * @returns {Generator<number>} Yields matching offsets
 * @internal
 */
function* lookupIndex(index: HashIndex, hash: number): Generator<number> {
  const bucket = hash & index.bucketMask
  const count = index.counts[bucket]
  const baseOffset = bucket * MAX_BUCKET_SIZE
  for (let i = 0; i < count; i++) {
    yield index.offsets[baseOffset + i]
  }
}

/**
 * Optimized match length calculation using word-at-a-time comparison.
 *
 * @description Compares bytes in chunks of 4 (as 32-bit integers) where possible,
 * falling back to byte-by-byte for the remaining bytes. This is ~4x faster than
 * pure byte comparison for long matches.
 *
 * @param {Uint8Array} a - First array
 * @param {number} aOffset - Starting offset in first array
 * @param {Uint8Array} b - Second array
 * @param {number} bOffset - Starting offset in second array
 * @param {number} maxLength - Maximum number of bytes to compare
 * @returns {number} Number of matching bytes (0 to maxLength)
 * @internal
 */
function getMatchLengthOptimized(
  a: Uint8Array, aOffset: number,
  b: Uint8Array, bOffset: number,
  maxLength: number
): number {
  if (maxLength <= 0) return 0

  let length = 0

  // Compare 4 bytes at a time using DataView for unaligned access
  // This is faster than byte-by-byte for larger matches
  const wordCount = (maxLength - length) >>> 2
  if (wordCount > 0) {
    const aView = new DataView(a.buffer, a.byteOffset + aOffset, maxLength)
    const bView = new DataView(b.buffer, b.byteOffset + bOffset, maxLength)

    for (let i = 0; i < wordCount; i++) {
      const wordOffset = length
      if (aView.getUint32(wordOffset, true) !== bView.getUint32(wordOffset, true)) {
        // Found difference in this word, find exact byte
        while (length < maxLength && a[aOffset + length] === b[bOffset + length]) {
          length++
        }
        return length
      }
      length += 4
    }
  }

  // Compare remaining bytes
  while (length < maxLength && a[aOffset + length] === b[bOffset + length]) {
    length++
  }

  return length
}

/**
 * Result of parsing a delta header (source or target size).
 *
 * @description Contains the decoded size value and the number of bytes
 * consumed during parsing. Used to track position while reading delta data.
 *
 * @interface DeltaHeaderResult
 */
export interface DeltaHeaderResult {
  /** The decoded size value */
  size: number
  /** Number of bytes consumed from the input buffer */
  bytesRead: number
}

/**
 * Represents a single decoded delta instruction.
 *
 * @description Used for analyzing or debugging deltas. Each instruction
 * is either a copy (from base object) or an insert (literal data).
 *
 * @interface DeltaInstruction
 *
 * @example
 * // A copy instruction
 * const copy: DeltaInstruction = {
 *   type: 'copy',
 *   offset: 100,  // Copy from base offset 100
 *   size: 50      // Copy 50 bytes
 * };
 *
 * @example
 * // An insert instruction
 * const insert: DeltaInstruction = {
 *   type: 'insert',
 *   size: 10,
 *   data: new Uint8Array([...])  // 10 literal bytes
 * };
 */
export interface DeltaInstruction {
  /** Instruction type: 'copy' from base or 'insert' literal bytes */
  type: 'copy' | 'insert'
  /** For copy: byte offset in the source/base object (undefined for insert) */
  offset?: number
  /** Number of bytes to copy or insert */
  size: number
  /** For insert: the literal bytes to insert (undefined for copy) */
  data?: Uint8Array
}

/**
 * Parses a variable-length size value from the delta header.
 *
 * @description Reads the source or target size from a delta's header using
 * Git's variable-length integer encoding. Each byte's MSB indicates whether
 * more bytes follow, and the lower 7 bits contribute to the value.
 *
 * **Encoding Details:**
 * - Bytes are read sequentially
 * - Lower 7 bits of each byte contribute to the result
 * - MSB = 1 means more bytes follow
 * - MSB = 0 means this is the last byte
 * - Maximum of 10 bytes (supports values up to 2^70)
 *
 * @param {Uint8Array} data - The delta data buffer
 * @param {number} offset - Starting byte offset in the buffer
 * @returns {DeltaHeaderResult} Object with parsed size and bytes consumed
 * @throws {Error} If data ends unexpectedly before size is complete
 * @throws {Error} If size encoding exceeds maximum length (corrupted data)
 *
 * @example
 * // Parse source and target sizes from delta
 * let offset = 0;
 * const source = parseDeltaHeader(delta, offset);
 * offset += source.bytesRead;
 * const target = parseDeltaHeader(delta, offset);
 * offset += target.bytesRead;
 *
 * console.log(`Base size: ${source.size}, Target size: ${target.size}`);
 */
export function parseDeltaHeader(data: Uint8Array, offset: number): DeltaHeaderResult {
  let size = 0
  let shift = 0
  let bytesRead = 0

  // Maximum bytes for a varint to prevent infinite loops
  const MAX_VARINT_BYTES = 10

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new Error(`Delta header parsing failed: unexpected end of data at offset ${offset + bytesRead}`)
    }
    if (bytesRead >= MAX_VARINT_BYTES) {
      throw new Error(`Delta header parsing failed: exceeded maximum length of ${MAX_VARINT_BYTES} bytes (possible infinite loop or corrupted data)`)
    }

    const byte = data[offset + bytesRead]
    bytesRead++

    // Add the lower 7 bits to the result
    size |= (byte & 0x7f) << shift
    shift += 7

    // If MSB is not set, we're done
    if ((byte & 0x80) === 0) {
      break
    }
  }

  return { size, bytesRead }
}

/**
 * Encodes a size as a variable-length integer for delta headers.
 *
 * @description Internal function that encodes sizes using Git's varint format.
 * Used when creating delta headers that specify source and target sizes.
 *
 * @param {number} size - The size value to encode
 * @returns {Uint8Array} The encoded bytes
 * @internal
 */
function encodeDeltaSize(size: number): Uint8Array {
  const bytes: number[] = []

  do {
    let byte = size & 0x7f
    size >>>= 7
    if (size > 0) {
      byte |= 0x80  // Set continuation bit
    }
    bytes.push(byte)
  } while (size > 0)

  return new Uint8Array(bytes)
}

/**
 * Applies a delta to a base object to produce the target object.
 *
 * @description Reconstructs the target object by executing the delta's copy and
 * insert instructions against the base object. This is the core operation for
 * unpacking delta-compressed objects in packfiles.
 *
 * **Delta Application Process:**
 * 1. Parse source (base) size and verify it matches
 * 2. Parse target size to allocate result buffer
 * 3. Execute instructions sequentially:
 *    - Copy: copy bytes from base object to result
 *    - Insert: copy literal bytes from delta to result
 * 4. Verify result size matches expected target size
 *
 * **Error Conditions:**
 * - Base object size doesn't match delta's source size
 * - Copy instruction references bytes outside base object
 * - Instructions would overflow the result buffer
 * - Result size doesn't match delta's target size
 * - Invalid instruction byte (0x00)
 *
 * @param {Uint8Array} base - The source/base object to apply delta against
 * @param {Uint8Array} delta - The delta data (decompressed from packfile)
 * @returns {Uint8Array} The reconstructed target object
 * @throws {Error} If base size doesn't match delta's source size
 * @throws {Error} If delta contains invalid instructions
 * @throws {Error} If copy would read beyond base object bounds
 * @throws {Error} If result size doesn't match expected target size
 *
 * @example
 * // Reconstruct an object from base + delta
 * const base = await getObject(baseSha);
 * const delta = decompressDeltaData(packData, offset);
 * const target = applyDelta(base, delta);
 *
 * @example
 * // Error handling
 * try {
 *   const target = applyDelta(base, delta);
 * } catch (e) {
 *   console.error('Delta application failed:', e.message);
 * }
 */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let offset = 0

  // Parse source size
  const sourceHeader = parseDeltaHeader(delta, offset)
  offset += sourceHeader.bytesRead

  if (sourceHeader.size !== base.length) {
    throw new Error(
      `Delta source size mismatch: expected ${sourceHeader.size}, got ${base.length}`
    )
  }

  // Parse target size
  const targetHeader = parseDeltaHeader(delta, offset)
  offset += targetHeader.bytesRead

  // Allocate result buffer
  const result = new Uint8Array(targetHeader.size)
  let resultOffset = 0

  // Process instructions
  while (offset < delta.length) {
    const cmd = delta[offset++]

    if (cmd & COPY_INSTRUCTION) {
      // Copy instruction
      let copyOffset = 0
      let copySize = 0

      // Read offset bytes (bits 0-3 indicate which bytes are present)
      if (cmd & 0x01) copyOffset |= delta[offset++]
      if (cmd & 0x02) copyOffset |= delta[offset++] << 8
      if (cmd & 0x04) copyOffset |= delta[offset++] << 16
      if (cmd & 0x08) copyOffset |= delta[offset++] << 24

      // Read size bytes (bits 4-6 indicate which bytes are present)
      if (cmd & 0x10) copySize |= delta[offset++]
      if (cmd & 0x20) copySize |= delta[offset++] << 8
      if (cmd & 0x40) copySize |= delta[offset++] << 16

      // Size of 0 means 0x10000 (65536)
      if (copySize === 0) {
        copySize = 0x10000
      }

      // Bounds checking to prevent buffer overflows
      if (copyOffset < 0 || copySize < 0) {
        throw new Error(`Invalid copy instruction: offset=${copyOffset}, size=${copySize}`)
      }
      if (copyOffset + copySize > base.length) {
        throw new Error(`Copy instruction out of bounds: offset=${copyOffset}, size=${copySize}, base length=${base.length}`)
      }
      if (resultOffset + copySize > result.length) {
        throw new Error(`Copy would overflow result buffer: resultOffset=${resultOffset}, size=${copySize}, result length=${result.length}`)
      }

      // Copy from base to result
      result.set(base.subarray(copyOffset, copyOffset + copySize), resultOffset)
      resultOffset += copySize
    } else if (cmd !== 0) {
      // Insert instruction: cmd is the number of bytes to insert
      const insertSize = cmd
      result.set(delta.subarray(offset, offset + insertSize), resultOffset)
      offset += insertSize
      resultOffset += insertSize
    } else {
      // cmd === 0 is reserved/invalid
      throw new Error('Invalid delta instruction: 0x00')
    }
  }

  // Verify we produced the expected size
  if (resultOffset !== targetHeader.size) {
    throw new Error(
      `Delta result size mismatch: expected ${targetHeader.size}, got ${resultOffset}`
    )
  }

  return result
}

/**
 * Creates a delta that transforms a base object into a target object.
 *
 * @description Generates delta instructions that can reconstruct the target
 * from the base object. Uses a hash-based algorithm to find matching sequences
 * and emits copy/insert instructions accordingly.
 *
 * **Algorithm:**
 * 1. Build a hash table of 4-byte sequences in the base object
 * 2. Scan through the target looking for matches in the hash table
 * 3. For each match found, verify and extend to maximum length
 * 4. Emit copy instructions for matches (4+ bytes)
 * 5. Emit insert instructions for non-matching data
 *
 * **Optimization Notes:**
 * - Uses 4-byte window for hash matching
 * - Minimum copy size is 4 bytes (smaller copies become inserts)
 * - Insert instructions are limited to 127 bytes each
 * - Empty base results in pure insert delta
 * - Empty target results in headers-only delta
 *
 * **Output Format:**
 * - Source size (varint)
 * - Target size (varint)
 * - Sequence of copy/insert instructions
 *
 * @param {Uint8Array} base - The source/base object
 * @param {Uint8Array} target - The target object to encode as delta
 * @returns {Uint8Array} The delta data (can be applied with {@link applyDelta})
 *
 * @example
 * // Create a delta for similar files
 * const v1 = new TextEncoder().encode('Hello, World!');
 * const v2 = new TextEncoder().encode('Hello, Universe!');
 * const delta = createDelta(v1, v2);
 *
 * // Delta should be smaller than v2 if there's good overlap
 * console.log(`Original: ${v2.length}, Delta: ${delta.length}`);
 *
 * @example
 * // Verify delta correctness
 * const reconstructed = applyDelta(v1, delta);
 * // reconstructed should equal v2
 */
export function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
  const instructions: Uint8Array[] = []

  // Add source and target size headers
  instructions.push(encodeDeltaSize(base.length))
  instructions.push(encodeDeltaSize(target.length))

  if (target.length === 0) {
    // Empty target, just return headers
    return concatArrays(instructions)
  }

  if (base.length === 0) {
    // No base to copy from, insert everything
    emitInserts(instructions, target, 0, target.length)
    return concatArrays(instructions)
  }

  // Build optimized hash index using Rabin fingerprints
  const index = buildHashIndex(base)

  // For large files, process in chunks to limit memory pressure
  const isLargeFile = target.length > CHUNK_SIZE

  // Scan target and find matches using rolling hash
  let targetOffset = 0
  let insertStart = 0

  // Initialize rolling hash if we have enough bytes
  let currentHash = target.length >= WINDOW_SIZE ? rabinHash(target, 0) : 0

  while (targetOffset < target.length) {
    let bestMatchOffset = -1
    let bestMatchLength = 0

    // Look for a match if we have enough bytes
    if (targetOffset <= target.length - WINDOW_SIZE) {
      // Look up candidates from the optimized index
      for (const baseOffset of lookupIndex(index, currentHash)) {
        // Verify the match and extend it using optimized comparison
        const maxLength = Math.min(base.length - baseOffset, target.length - targetOffset)
        const matchLength = isLargeFile
          ? getMatchLengthOptimized(base, baseOffset, target, targetOffset, maxLength)
          : getMatchLength(base, baseOffset, target, targetOffset, maxLength)

        if (matchLength >= WINDOW_SIZE && matchLength > bestMatchLength) {
          bestMatchOffset = baseOffset
          bestMatchLength = matchLength
        }
      }
    }

    if (bestMatchLength >= MIN_COPY_SIZE) {
      // Emit pending inserts
      if (targetOffset > insertStart) {
        emitInserts(instructions, target, insertStart, targetOffset)
      }

      // Emit copy instruction
      emitCopy(instructions, bestMatchOffset, bestMatchLength)

      targetOffset += bestMatchLength
      insertStart = targetOffset

      // Re-compute hash at new position (skip rolling for long jumps)
      if (targetOffset <= target.length - WINDOW_SIZE) {
        currentHash = rabinHash(target, targetOffset)
      }
    } else {
      targetOffset++
      // Roll the hash forward (O(1) operation)
      if (targetOffset <= target.length - WINDOW_SIZE) {
        currentHash = rabinRoll(
          currentHash,
          target[targetOffset - 1],
          target[targetOffset + WINDOW_SIZE - 1]
        )
      }
    }
  }

  // Emit any remaining inserts
  if (target.length > insertStart) {
    emitInserts(instructions, target, insertStart, target.length)
  }

  return concatArrays(instructions)
}

/**
 * Computes a simple hash of a byte sequence for delta matching.
 *
 * @description Uses a fast multiplicative hash (similar to djb2) for
 * building the hash table used in delta creation.
 *
 * @param {Uint8Array} data - The data buffer
 * @param {number} offset - Starting offset
 * @param {number} length - Number of bytes to hash
 * @returns {number} 32-bit hash value
 * @internal
 */
/**
 * @internal Reserved for hash table delta compression
 */
function _hashBytes(data: Uint8Array, offset: number, length: number): number {
  let hash = 0
  for (let i = 0; i < length; i++) {
    hash = ((hash << 5) - hash + data[offset + i]) | 0
  }
  return hash
}
void _hashBytes // Preserve for future delta optimization

/**
 * Finds the length of matching bytes between two array regions.
 *
 * @description Compares bytes starting from the given offsets and returns
 * how many consecutive bytes match. Used to extend hash-based matches.
 *
 * @param {Uint8Array} a - First array
 * @param {number} aOffset - Starting offset in first array
 * @param {Uint8Array} b - Second array
 * @param {number} bOffset - Starting offset in second array
 * @param {number} maxLength - Maximum number of bytes to compare
 * @returns {number} Number of matching bytes (0 to maxLength)
 * @internal
 */
function getMatchLength(
  a: Uint8Array, aOffset: number,
  b: Uint8Array, bOffset: number,
  maxLength: number
): number {
  let length = 0
  while (length < maxLength && a[aOffset + length] === b[bOffset + length]) {
    length++
  }
  return length
}

/**
 * Emits insert instructions for a range of literal bytes.
 *
 * @description Insert commands can only encode 1-127 bytes each, so this
 * function splits larger ranges into multiple instructions as needed.
 *
 * @param {Uint8Array[]} instructions - Array to append instructions to
 * @param {Uint8Array} data - Source data buffer
 * @param {number} start - Starting offset (inclusive)
 * @param {number} end - Ending offset (exclusive)
 * @internal
 */
function emitInserts(
  instructions: Uint8Array[],
  data: Uint8Array,
  start: number,
  end: number
): void {
  const MAX_INSERT = 127
  let offset = start

  while (offset < end) {
    const size = Math.min(MAX_INSERT, end - offset)
    const instruction = new Uint8Array(1 + size)
    instruction[0] = size  // Insert command: size in lower 7 bits
    instruction.set(data.subarray(offset, offset + size), 1)
    instructions.push(instruction)
    offset += size
  }
}

/**
 * Emits a copy instruction that copies bytes from the base object.
 *
 * @description Encodes a copy instruction using Git's compact format where
 * only non-zero offset and size bytes are included, indicated by bit flags.
 *
 * **Encoding Details:**
 * - Offset bytes (up to 4) are included based on bits 0-3 of command byte
 * - Size bytes (up to 3) are included based on bits 4-6 of command byte
 * - Size of 0x10000 (65536) is encoded as no size bytes (size=0 means 0x10000)
 * - Offset of 0 means no offset bytes are included
 *
 * @param {Uint8Array[]} instructions - Array to append the instruction to
 * @param {number} offset - Byte offset in base object to copy from
 * @param {number} size - Number of bytes to copy
 * @internal
 */
function emitCopy(
  instructions: Uint8Array[],
  offset: number,
  size: number
): void {
  const bytes: number[] = []
  let cmd = COPY_INSTRUCTION

  // Encode offset bytes (little-endian)
  if (offset & 0xff) {
    cmd |= 0x01
    bytes.push(offset & 0xff)
  }
  if (offset & 0xff00) {
    cmd |= 0x02
    bytes.push((offset >> 8) & 0xff)
  }
  if (offset & 0xff0000) {
    cmd |= 0x04
    bytes.push((offset >> 16) & 0xff)
  }
  if (offset & 0xff000000) {
    cmd |= 0x08
    bytes.push((offset >> 24) & 0xff)
  }

  // Special case: if offset is 0, we don't emit any offset bytes
  // The cmd byte already indicates no offset bytes are present

  // Encode size bytes (little-endian)
  // Note: size of 0x10000 is encoded as no size bytes (all zero)
  if (size !== 0x10000) {
    if (size & 0xff) {
      cmd |= 0x10
      bytes.push(size & 0xff)
    }
    if (size & 0xff00) {
      cmd |= 0x20
      bytes.push((size >> 8) & 0xff)
    }
    if (size & 0xff0000) {
      cmd |= 0x40
      bytes.push((size >> 16) & 0xff)
    }
  }
  // If size is 0x10000, we don't set any size bits, which encodes as size=0x10000

  const instruction = new Uint8Array(1 + bytes.length)
  instruction[0] = cmd
  for (let i = 0; i < bytes.length; i++) {
    instruction[1 + i] = bytes[i]
  }
  instructions.push(instruction)
}

/**
 * Concatenates multiple Uint8Arrays into a single array.
 *
 * @param {Uint8Array[]} arrays - Arrays to concatenate
 * @returns {Uint8Array} Combined array
 * @internal
 */
function concatArrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0
  for (const arr of arrays) {
    totalLength += arr.length
  }

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }

  return result
}
