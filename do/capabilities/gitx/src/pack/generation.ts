/**
 * @fileoverview Git Packfile Generation
 *
 * This module provides comprehensive packfile generation capabilities for creating
 * Git packfiles programmatically. It supports both full object storage and delta
 * compression for efficient packing.
 *
 * ## Features
 *
 * - **Full Object Packing**: Store objects without delta compression
 * - **Delta Compression**: Automatic OFS_DELTA generation for similar objects
 * - **REF_DELTA Support**: Reference-based deltas for thin packs
 * - **Configurable Options**: Control delta depth, window size, compression level
 * - **Thin Pack Generation**: Create packs that reference external objects
 *
 * ## Pack Structure
 *
 * Generated packfiles follow the Git packfile v2 format:
 * - 12-byte header (signature + version + object count)
 * - Sequence of packed objects (header + compressed data)
 * - 20-byte SHA-1 trailer
 *
 * ## Delta Compression
 *
 * When enabled, the generator uses a sliding window approach to find similar
 * objects and create delta chains. OFS_DELTA is preferred as it's more efficient
 * than REF_DELTA for local storage.
 *
 * @module pack/generation
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Simple packfile generation
 * import { generatePackfile, PackableObject, PackObjectType } from './generation';
 *
 * const objects: PackableObject[] = [
 *   { sha: 'abc123...', type: PackObjectType.OBJ_BLOB, data: blobData }
 * ];
 * const packfile = generatePackfile(objects);
 *
 * @example
 * // Using PackfileGenerator with options
 * import { PackfileGenerator, PackObjectType } from './generation';
 *
 * const generator = new PackfileGenerator({
 *   enableDeltaCompression: true,
 *   maxDeltaDepth: 50,
 *   windowSize: 10
 * });
 *
 * generator.addObject({ sha: '...', type: PackObjectType.OBJ_BLOB, data: ... });
 * const result = generator.generate();
 */

import pako from 'pako'
import { PackObjectType, encodeTypeAndSize } from './format'
import { createDelta } from './delta'
import { sha1 } from '../utils/sha1'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Represents an object that can be packed into a packfile.
 *
 * @description Contains all the information needed to add an object to a pack:
 * the object's SHA-1 identifier, its type, raw data, and optional path for
 * delta base selection optimization.
 *
 * @interface PackableObject
 *
 * @example
 * const blob: PackableObject = {
 *   sha: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
 *   type: PackObjectType.OBJ_BLOB,
 *   data: new TextEncoder().encode('Hello, World!'),
 *   path: 'README.md' // Optional: helps with delta base selection
 * };
 */
export interface PackableObject {
  /** The 40-character hexadecimal SHA-1 hash of the object */
  sha: string
  /** The Git object type (commit, tree, blob, or tag) */
  type: PackObjectType
  /** The raw (uncompressed) object data */
  data: Uint8Array
  /** Optional file path, used to improve delta base selection */
  path?: string
}

/**
 * Represents a delta object that references an external base.
 *
 * @description Used for REF_DELTA objects in thin packs where the base
 * object is not included in the packfile. The receiver must have the base
 * object available to reconstruct the target.
 *
 * @interface DeltaObject
 */
export interface DeltaObject {
  /** SHA-1 of the delta object itself */
  sha: string
  /** The original object type (before delta encoding) */
  type: PackObjectType
  /** SHA-1 of the base object this delta references */
  baseSha: string
  /** The delta data (instructions to transform base to target) */
  delta: Uint8Array
}

/**
 * Configuration options for the PackfileGenerator.
 *
 * @description Controls how objects are packed, including delta compression
 * settings, compression level, and minimum object sizes for delta consideration.
 *
 * @interface GeneratorOptions
 *
 * @example
 * const options: GeneratorOptions = {
 *   enableDeltaCompression: true,
 *   maxDeltaDepth: 50,
 *   windowSize: 10,
 *   compressionLevel: 6
 * };
 */
export interface GeneratorOptions {
  /** Enable delta compression (default: false) */
  enableDeltaCompression?: boolean
  /** Maximum depth of delta chains (default: 50) */
  maxDeltaDepth?: number
  /** Number of objects to consider as delta bases (default: 10) */
  windowSize?: number
  /** Zlib compression level 0-9 (default: 6) */
  compressionLevel?: number
  /** Use REF_DELTA instead of OFS_DELTA (default: false) */
  useRefDelta?: boolean
  /** Minimum object size to consider for delta compression (default: 0) */
  minDeltaSize?: number
}

/**
 * Statistics collected during pack generation.
 *
 * @description Provides metrics about the generated packfile including
 * object counts, sizes, compression ratios, and timing information.
 *
 * @interface PackGenerationStats
 */
export interface PackGenerationStats {
  /** Total number of objects in the packfile */
  totalObjects: number
  /** Number of objects stored as deltas */
  deltaObjects: number
  /** Total uncompressed size of all objects in bytes */
  totalSize: number
  /** Total compressed size of all object data in bytes */
  compressedSize: number
  /** Maximum delta chain depth achieved */
  maxDeltaDepth: number
  /** Time taken to generate the packfile in milliseconds */
  generationTimeMs: number
}

/**
 * Result returned by PackfileGenerator.generate().
 *
 * @description Contains the generated packfile data (without trailing checksum),
 * the computed checksum, and generation statistics. To create a complete packfile,
 * concatenate packData with checksum.
 *
 * @interface GeneratedPackfile
 *
 * @example
 * const result = generator.generate();
 * // Create complete packfile
 * const complete = new Uint8Array(result.packData.length + 20);
 * complete.set(result.packData, 0);
 * complete.set(result.checksum, result.packData.length);
 */
export interface GeneratedPackfile {
  /** Packfile data (header + objects, without trailing checksum) */
  packData: Uint8Array
  /** SHA-1 checksum of packData */
  checksum: Uint8Array
  /** Statistics from the generation process */
  stats: PackGenerationStats
}

/**
 * Represents a candidate for delta base selection.
 *
 * @description Contains the essential information about an object that could
 * serve as a delta base. Used by the thin pack generator to evaluate
 * potential base objects for delta compression.
 *
 * @interface DeltaCandidate
 */
export interface DeltaCandidate {
  /** SHA-1 of the candidate base object */
  sha: string
  /** Object type (must match target for delta consideration) */
  type: PackObjectType
  /** Raw object data (used to compute delta) */
  data: Uint8Array
}

/**
 * Options for thin pack generation.
 *
 * @description Thin packs contain REF_DELTA objects that reference base objects
 * not included in the pack. This is used for network transfers where the receiver
 * is expected to already have the base objects.
 *
 * @interface ThinPackOptions
 */
export interface ThinPackOptions {
  /** Set of SHA-1 hashes of objects the receiver already has */
  externalObjects: Set<string>
  /** Optional map of SHA to data for external objects (for computing deltas) */
  baseData?: Map<string, Uint8Array>
}

/**
 * Result of thin pack generation.
 *
 * @description Contains the generated thin pack along with metadata about
 * its structure and any missing base objects.
 *
 * @interface ThinPackResult
 */
export interface ThinPackResult {
  /** The generated packfile data (without trailing checksum) */
  packData: Uint8Array
  /** SHA-1 checksum of the pack data */
  checksum: Uint8Array
  /** Whether the pack contains REF_DELTA objects referencing external bases */
  isThin: boolean
  /** List of base SHA-1s that are referenced but not included */
  missingBases: string[]
  /** Generation statistics */
  stats: PackGenerationStats
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Computes the SHA-1 checksum of pack content.
 *
 * @description Calculates the 20-byte SHA-1 hash that serves as the pack's
 * checksum/trailer. This checksum is appended to the pack and also used
 * in the corresponding .idx file.
 *
 * @param {Uint8Array} data - The pack data to checksum
 * @returns {Uint8Array} 20-byte SHA-1 checksum
 *
 * @example
 * const packWithoutChecksum = generatePackContent(objects);
 * const checksum = computePackChecksum(packWithoutChecksum);
 * // Append checksum to create complete packfile
 */
export function computePackChecksum(data: Uint8Array): Uint8Array {
  return sha1(data)
}

/**
 * Creates the 12-byte pack file header.
 *
 * @param {number} objectCount - Number of objects in the pack
 * @returns {Uint8Array} 12-byte header (signature + version + count)
 * @internal
 */
function createPackHeader(objectCount: number): Uint8Array {
  const header = new Uint8Array(12)
  // Signature: "PACK"
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
  header[8] = (objectCount >> 24) & 0xff
  header[9] = (objectCount >> 16) & 0xff
  header[10] = (objectCount >> 8) & 0xff
  header[11] = objectCount & 0xff

  return header
}

/**
 * Encodes an offset for OFS_DELTA using Git's variable-length format.
 *
 * @description Uses a special encoding where each byte after the first
 * must subtract 1 before shifting to avoid ambiguity.
 *
 * @param {number} offset - The byte offset to encode
 * @returns {Uint8Array} Encoded offset bytes
 * @internal
 */
function encodeOffset(offset: number): Uint8Array {
  const bytes: number[] = []

  // First byte: 7 bits of offset (no continuation)
  bytes.push(offset & 0x7f)
  offset >>>= 7

  // Subsequent bytes: continuation bit + 7 bits, but we need to subtract 1
  // to avoid ambiguity
  while (offset > 0) {
    offset -= 1
    bytes.unshift((offset & 0x7f) | 0x80)
    offset >>>= 7
  }

  return new Uint8Array(bytes)
}

/**
 * Converts a hexadecimal string to bytes.
 *
 * @param {string} hex - Hex string to convert
 * @returns {Uint8Array} Decoded bytes
 * @internal
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Concatenates multiple Uint8Arrays into one.
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

/**
 * Calculates similarity between two byte arrays using hash-based comparison.
 *
 * @description Uses a simple approach: counts matching 4-byte sequences between
 * the arrays. For small arrays, falls back to byte-by-byte comparison.
 *
 * @param {Uint8Array} a - First byte array
 * @param {Uint8Array} b - Second byte array
 * @returns {number} Similarity score between 0 and 1
 * @internal
 */
function calculateSimilarity(a: Uint8Array, b: Uint8Array): number {
  if (a.length === 0 || b.length === 0) return 0

  // Use a simple approach: count matching 4-byte sequences
  const windowSize = 4
  if (a.length < windowSize || b.length < windowSize) {
    // For small objects, compare byte by byte
    let matches = 0
    const minLen = Math.min(a.length, b.length)
    for (let i = 0; i < minLen; i++) {
      if (a[i] === b[i]) matches++
    }
    return matches / Math.max(a.length, b.length)
  }

  // Build hash set from 'a'
  const hashes = new Set<number>()
  for (let i = 0; i <= a.length - windowSize; i++) {
    let hash = 0
    for (let j = 0; j < windowSize; j++) {
      hash = ((hash << 5) - hash + a[i + j]) | 0
    }
    hashes.add(hash)
  }

  // Count matches in 'b'
  let matches = 0
  for (let i = 0; i <= b.length - windowSize; i++) {
    let hash = 0
    for (let j = 0; j < windowSize; j++) {
      hash = ((hash << 5) - hash + b[i + j]) | 0
    }
    if (hashes.has(hash)) matches++
  }

  return matches / Math.max(a.length - windowSize + 1, b.length - windowSize + 1)
}

// ============================================================================
// Object Ordering
// ============================================================================

/**
 * Orders objects for optimal delta compression.
 *
 * @description Sorts objects to maximize delta compression efficiency by:
 * 1. Grouping by type (commits, trees, blobs, tags)
 * 2. Within each type, grouping by path (similar files together)
 * 3. Within path groups, sorting by size (larger first as better bases)
 *
 * This ordering ensures that similar objects are adjacent, improving the
 * chances of finding good delta bases within the sliding window.
 *
 * @param {PackableObject[]} objects - Objects to order
 * @returns {PackableObject[]} New array with objects in optimal order
 *
 * @example
 * const ordered = orderObjectsForCompression(objects);
 * // Use ordered array for pack generation
 */
export function orderObjectsForCompression(objects: PackableObject[]): PackableObject[] {
  // Define type order: commits, trees, blobs, tags
  const typeOrder: Record<PackObjectType, number> = {
    [PackObjectType.OBJ_COMMIT]: 0,
    [PackObjectType.OBJ_TREE]: 1,
    [PackObjectType.OBJ_BLOB]: 2,
    [PackObjectType.OBJ_TAG]: 3,
    [PackObjectType.OBJ_OFS_DELTA]: 4,
    [PackObjectType.OBJ_REF_DELTA]: 5
  }

  return [...objects].sort((a, b) => {
    // First, sort by type
    const typeCompare = typeOrder[a.type] - typeOrder[b.type]
    if (typeCompare !== 0) return typeCompare

    // Within same type, sort by path if available (groups similar files)
    if (a.path && b.path) {
      const pathCompare = a.path.localeCompare(b.path)
      if (pathCompare !== 0) return pathCompare
    }

    // Then by size (larger first - better delta bases)
    return b.data.length - a.data.length
  })
}

/**
 * Selects the best delta base from a set of candidates.
 *
 * @description Evaluates each candidate by computing similarity with the target
 * and returns the most similar object if it exceeds the threshold.
 *
 * **Selection Criteria:**
 * - Must be same type as target
 * - Must not be the target itself
 * - Similarity must exceed 30% threshold
 *
 * @param {DeltaCandidate} target - The object to find a base for
 * @param {DeltaCandidate[]} candidates - Potential base objects
 * @returns {DeltaCandidate | null} Best candidate or null if none suitable
 *
 * @example
 * const base = selectDeltaBase(targetObj, windowObjects);
 * if (base) {
 *   const delta = createDelta(base.data, targetObj.data);
 * }
 */
export function selectDeltaBase(
  target: DeltaCandidate,
  candidates: DeltaCandidate[]
): DeltaCandidate | null {
  if (candidates.length === 0) return null

  let bestCandidate: DeltaCandidate | null = null
  let bestSimilarity = 0

  for (const candidate of candidates) {
    // Only consider same type for delta
    if (candidate.type !== target.type) continue
    // Don't delta against self
    if (candidate.sha === target.sha) continue

    const similarity = calculateSimilarity(candidate.data, target.data)
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      bestCandidate = candidate
    }
  }

  // Only return if similarity is good enough
  return bestSimilarity > 0.3 ? bestCandidate : null
}

// ============================================================================
// Packfile Generator Class
// ============================================================================

/**
 * Internal representation of an object during pack generation.
 * @internal
 */
interface InternalObject {
  sha: string
  type: PackObjectType
  data: Uint8Array
  path?: string
  isDelta: boolean
  baseSha?: string
  baseOffset?: number
  deltaData?: Uint8Array
  depth: number
}

/**
 * Generator class for creating Git packfiles.
 *
 * @description Provides a fluent API for building packfiles with support for:
 * - Adding objects incrementally
 * - Optional delta compression with configurable parameters
 * - Both OFS_DELTA and REF_DELTA encoding
 * - Statistics collection during generation
 *
 * **Usage Pattern:**
 * 1. Create generator with desired options
 * 2. Add objects using addObject() or addDeltaObject()
 * 3. Call generate() to produce the packfile
 * 4. Optionally call reset() to reuse the generator
 *
 * @class PackfileGenerator
 *
 * @example
 * // Basic usage
 * const generator = new PackfileGenerator();
 * generator.addObject({ sha: '...', type: PackObjectType.OBJ_BLOB, data: ... });
 * generator.addObject({ sha: '...', type: PackObjectType.OBJ_TREE, data: ... });
 * const result = generator.generate();
 *
 * @example
 * // With delta compression
 * const generator = new PackfileGenerator({
 *   enableDeltaCompression: true,
 *   maxDeltaDepth: 50,
 *   windowSize: 10
 * });
 *
 * for (const obj of objects) {
 *   generator.addObject(obj);
 * }
 *
 * const { packData, checksum, stats } = generator.generate();
 * console.log(`Compressed ${stats.deltaObjects} objects as deltas`);
 */
export class PackfileGenerator {
  private objects: Map<string, InternalObject> = new Map()
  private deltaObjects: DeltaObject[] = []
  private options: GeneratorOptions

  /**
   * Creates a new PackfileGenerator with the specified options.
   *
   * @param {GeneratorOptions} [options={}] - Configuration options
   */
  constructor(options: GeneratorOptions = {}) {
    this.options = {
      enableDeltaCompression: options.enableDeltaCompression ?? false,
      maxDeltaDepth: options.maxDeltaDepth ?? 50,
      windowSize: options.windowSize ?? 10,
      compressionLevel: options.compressionLevel ?? 6,
      useRefDelta: options.useRefDelta ?? false,
      minDeltaSize: options.minDeltaSize ?? 0  // Default to 0, use caller-specified value if set
    }
  }

  /**
   * Gets the total number of objects added to the generator.
   * @returns {number} Count of regular objects plus delta objects
   */
  get objectCount(): number {
    return this.objects.size + this.deltaObjects.length
  }

  /**
   * Adds an object to be included in the packfile.
   *
   * @description Objects are deduplicated by SHA. If an object with the same SHA
   * has already been added, this call is a no-op.
   *
   * @param {PackableObject} object - The object to add
   */
  addObject(object: PackableObject): void {
    // Skip duplicates
    if (this.objects.has(object.sha)) return

    this.objects.set(object.sha, {
      sha: object.sha,
      type: object.type,
      data: object.data,
      path: object.path,
      isDelta: false,
      depth: 0
    })
  }

  /**
   * Adds a pre-computed delta object for thin pack generation.
   *
   * @description Use this for REF_DELTA objects that reference external bases.
   * The delta must already be computed.
   *
   * @param {DeltaObject} deltaObj - The delta object to add
   */
  addDeltaObject(deltaObj: DeltaObject): void {
    this.deltaObjects.push(deltaObj)
  }

  /**
   * Resets the generator to its initial state.
   *
   * @description Clears all added objects and delta objects, allowing the
   * generator to be reused for a new packfile.
   */
  reset(): void {
    this.objects.clear()
    this.deltaObjects = []
  }

  /**
   * Generates the packfile from all added objects.
   *
   * @description Produces a complete packfile including:
   * - 12-byte header
   * - All objects (with optional delta compression)
   * - Generation statistics
   *
   * Note: The returned packData does NOT include the trailing checksum.
   * Concatenate packData with checksum to create the complete packfile.
   *
   * @returns {GeneratedPackfile} Pack data, checksum, and statistics
   *
   * @example
   * const result = generator.generate();
   * // Write complete packfile
   * const complete = new Uint8Array(result.packData.length + 20);
   * complete.set(result.packData);
   * complete.set(result.checksum, result.packData.length);
   */
  generate(): GeneratedPackfile {
    const startTime = Date.now()

    let totalSize = 0
    let compressedSize = 0
    let deltaCount = 0
    let maxDeltaDepth = 0

    // Get all objects and order them
    const objectList = Array.from(this.objects.values())
    const orderedObjects = orderObjectsForCompression(
      objectList.map(o => ({ sha: o.sha, type: o.type, data: o.data, path: o.path }))
    )

    // Calculate total size
    for (const obj of orderedObjects) {
      totalSize += obj.data.length
    }

    // Build offset map for OFS_DELTA
    const offsetMap = new Map<string, number>()
    const parts: Uint8Array[] = []

    // Create header
    const header = createPackHeader(orderedObjects.length + this.deltaObjects.length)
    parts.push(header)
    let currentOffset = 12 // After header

    // Compute delta chains if enabled
    const deltaChains = new Map<string, { base: InternalObject; delta: Uint8Array; depth: number }>()

    if (this.options.enableDeltaCompression) {
      // Window of recent objects for delta comparison
      const window: InternalObject[] = []
      const depthMap = new Map<string, number>()

      for (const obj of orderedObjects) {
        const internalObj = this.objects.get(obj.sha)!

        // Skip small objects
        if (obj.data.length < (this.options.minDeltaSize ?? 50)) {
          window.push(internalObj)
          if (window.length > (this.options.windowSize ?? 10)) {
            window.shift()
          }
          continue
        }

        // Look for a good base in the window
        let bestBase: InternalObject | null = null
        let bestDelta: Uint8Array | null = null
        let bestSavings = 0

        for (const candidate of window) {
          if (candidate.type !== obj.type) continue

          // Check depth limit
          const candidateDepth = depthMap.get(candidate.sha) ?? 0
          if (candidateDepth >= (this.options.maxDeltaDepth ?? 50)) continue

          const delta = createDelta(candidate.data, obj.data)
          const savings = obj.data.length - delta.length

          if (savings > bestSavings && delta.length < obj.data.length * 0.9) {
            bestBase = candidate
            bestDelta = delta
            bestSavings = savings
          }
        }

        if (bestBase && bestDelta) {
          const depth = (depthMap.get(bestBase.sha) ?? 0) + 1
          deltaChains.set(obj.sha, { base: bestBase, delta: bestDelta, depth })
          depthMap.set(obj.sha, depth)
          if (depth > maxDeltaDepth) maxDeltaDepth = depth
        }

        window.push(internalObj)
        if (window.length > (this.options.windowSize ?? 10)) {
          window.shift()
        }
      }
    }

    // Write objects
    for (const obj of orderedObjects) {
      const objStart = currentOffset
      offsetMap.set(obj.sha, objStart)

      const deltaInfo = deltaChains.get(obj.sha)

      if (deltaInfo && offsetMap.has(deltaInfo.base.sha)) {
        // Write as OFS_DELTA
        const baseOffset = offsetMap.get(deltaInfo.base.sha)!
        const relativeOffset = objStart - baseOffset

        // OFS_DELTA header
        const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_OFS_DELTA, deltaInfo.delta.length)
        const offsetEncoded = encodeOffset(relativeOffset)
        const compressed = pako.deflate(deltaInfo.delta, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

        parts.push(typeAndSize)
        parts.push(offsetEncoded)
        parts.push(compressed)

        currentOffset += typeAndSize.length + offsetEncoded.length + compressed.length
        compressedSize += compressed.length
        deltaCount++
      } else {
        // Write as full object
        const typeAndSize = encodeTypeAndSize(obj.type, obj.data.length)
        const compressed = pako.deflate(obj.data, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

        parts.push(typeAndSize)
        parts.push(compressed)

        currentOffset += typeAndSize.length + compressed.length
        compressedSize += compressed.length
      }
    }

    // Write REF_DELTA objects
    for (const deltaObj of this.deltaObjects) {
      // REF_DELTA header
      const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, deltaObj.delta.length)
      const baseShaBytes = hexToBytes(deltaObj.baseSha)
      const compressed = pako.deflate(deltaObj.delta, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

      parts.push(typeAndSize)
      parts.push(baseShaBytes)
      parts.push(compressed)

      currentOffset += typeAndSize.length + baseShaBytes.length + compressed.length
      compressedSize += compressed.length
      totalSize += deltaObj.delta.length
    }

    // Combine all parts (this is the pack data without trailing checksum)
    const packData = concatArrays(parts)

    // Calculate checksum of the pack data
    const checksum = computePackChecksum(packData)

    const generationTimeMs = Date.now() - startTime

    // packData does NOT include the trailing checksum
    // To get a complete packfile, concatenate packData + checksum
    // This allows the caller to verify or manipulate the pack before finalizing
    return {
      packData,
      checksum,
      stats: {
        totalObjects: orderedObjects.length + this.deltaObjects.length,
        deltaObjects: deltaCount,
        totalSize,
        compressedSize,
        maxDeltaDepth,
        generationTimeMs
      }
    }
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generates a complete packfile from an array of objects.
 *
 * @description Convenience function that creates a PackfileGenerator, adds all
 * objects, generates the pack, and returns a complete packfile with the trailing
 * SHA-1 checksum appended.
 *
 * This function does not use delta compression. For delta compression, use
 * the PackfileGenerator class directly with enableDeltaCompression option.
 *
 * @param {PackableObject[]} objects - Array of objects to pack
 * @returns {Uint8Array} Complete packfile with header, objects, and checksum
 *
 * @example
 * const objects: PackableObject[] = [
 *   { sha: 'abc...', type: PackObjectType.OBJ_BLOB, data: blobData },
 *   { sha: 'def...', type: PackObjectType.OBJ_TREE, data: treeData },
 *   { sha: 'ghi...', type: PackObjectType.OBJ_COMMIT, data: commitData }
 * ];
 *
 * const packfile = generatePackfile(objects);
 * await fs.writeFile('pack-abc123.pack', packfile);
 */
export function generatePackfile(objects: PackableObject[]): Uint8Array {
  const generator = new PackfileGenerator()

  for (const obj of objects) {
    generator.addObject(obj)
  }

  const result = generator.generate()

  // Combine packData with checksum to form complete packfile
  const completePackfile = new Uint8Array(result.packData.length + result.checksum.length)
  completePackfile.set(result.packData, 0)
  completePackfile.set(result.checksum, result.packData.length)

  return completePackfile
}

/**
 * Generates a thin pack that can reference external base objects.
 *
 * @description Creates a packfile where objects can be stored as REF_DELTA
 * referencing base objects not included in the pack. This is typically used
 * for network transfers where the receiver already has some objects.
 *
 * **Thin Pack Behavior:**
 * - Attempts to delta-compress objects against external bases
 * - Uses REF_DELTA format (base referenced by SHA-1)
 * - Falls back to full objects when delta is not beneficial
 * - Tracks which external bases are referenced
 *
 * @param {PackableObject[]} objects - Array of objects to pack
 * @param {ThinPackOptions} options - Configuration including external object set
 * @returns {ThinPackResult} Pack data, checksum, and metadata about external refs
 *
 * @example
 * // Generate thin pack for git push
 * const externalObjects = new Set(['abc123...', 'def456...']); // Objects server has
 * const baseData = new Map([['abc123...', baseObjData]]);      // Data for delta computation
 *
 * const result = generateThinPack(objectsToSend, {
 *   externalObjects,
 *   baseData
 * });
 *
 * console.log(`Created thin pack with ${result.missingBases.length} external refs`);
 */
export function generateThinPack(
  objects: PackableObject[],
  options: ThinPackOptions
): ThinPackResult {
  const startTime = Date.now()
  const missingBases: string[] = []
  let deltaCount = 0
  let totalSize = 0
  let compressedSize = 0

  // Check if any objects can use external bases
  const hasExternalBases = options.externalObjects.size > 0

  const parts: Uint8Array[] = []

  // Create header
  const header = createPackHeader(objects.length)
  parts.push(header)

  // Process objects
  for (const obj of objects) {
    totalSize += obj.data.length

    // Try to find an external base for delta
    let usedExternalBase = false

    if (hasExternalBases && options.baseData) {
      for (const externalSha of options.externalObjects) {
        const baseData = options.baseData.get(externalSha)
        if (baseData) {
          // Calculate similarity
          const similarity = calculateSimilarity(baseData, obj.data)
          if (similarity > 0.3) {
            // Create delta
            const delta = createDelta(baseData, obj.data)
            if (delta.length < obj.data.length * 0.9) {
              // Use REF_DELTA
              const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, delta.length)
              const baseShaBytes = hexToBytes(externalSha)
              const compressed = pako.deflate(delta)

              parts.push(typeAndSize)
              parts.push(baseShaBytes)
              parts.push(compressed)

              compressedSize += compressed.length
              deltaCount++
              usedExternalBase = true

              if (!missingBases.includes(externalSha)) {
                missingBases.push(externalSha)
              }
              break
            }
          }
        }
      }
    }

    if (!usedExternalBase) {
      // Write as full object
      const typeAndSize = encodeTypeAndSize(obj.type, obj.data.length)
      const compressed = pako.deflate(obj.data)

      parts.push(typeAndSize)
      parts.push(compressed)

      compressedSize += compressed.length
    }
  }

  // Combine all parts
  const packData = concatArrays(parts)

  // Calculate checksum
  const checksum = computePackChecksum(packData)

  // Create final packfile with checksum
  const finalPack = new Uint8Array(packData.length + 20)
  finalPack.set(packData, 0)
  finalPack.set(checksum, packData.length)

  const generationTimeMs = Date.now() - startTime

  // A pack is considered "thin" if it's generated with the capability to reference
  // external objects, even if no actual external references were used
  const isThin = hasExternalBases

  return {
    packData: finalPack,
    checksum,
    isThin,
    missingBases,
    stats: {
      totalObjects: objects.length,
      deltaObjects: deltaCount,
      totalSize,
      compressedSize,
      maxDeltaDepth: deltaCount > 0 ? 1 : 0,
      generationTimeMs
    }
  }
}
