/**
 * @dotdo/gitx Core - Platform-Agnostic Git Implementation
 *
 * This module exports the core Git implementation that can run in any JavaScript
 * runtime (Node.js, Deno, Cloudflare Workers, browsers, etc.).
 *
 * The core package has ZERO Cloudflare dependencies and provides:
 * - Git object model (blob, tree, commit, tag)
 * - Pack file format (parsing, creation, delta encoding)
 * - Hash utilities (SHA-1 calculation)
 *
 * @module @dotdo/gitx
 *
 * @example
 * ```typescript
 * import {
 *   GitBlob,
 *   GitTree,
 *   GitCommit,
 *   GitTag,
 *   calculateObjectHash,
 *   parsePackHeader,
 * } from '@dotdo/gitx'
 *
 * // Create a blob
 * const blob = new GitBlob(new TextEncoder().encode('Hello, World!'))
 * const hash = await blob.hash()
 *
 * // Create a tree
 * const tree = new GitTree([
 *   { mode: '100644', name: 'hello.txt', sha: hash }
 * ])
 * ```
 */

// =============================================================================
// Git Objects
// =============================================================================

export {
  // Core Classes
  GitBlob,
  GitTree,
  GitCommit,
  GitTag,

  // Tree utilities
  sortTreeEntries,
  parseTreeEntries,
  serializeTreeEntries,

  // Commit utilities
  parseIdentity,
  formatIdentity,
  hasGpgSignature,
  parseGpgSignature,

  // Types
  type TreeEntry,
  type GitIdentity,
  type ObjectType,
  type GitObjectData,
  type BlobData,
  type TreeData,
  type CommitData,
  type TagData,

  // Constants
  OBJECT_TYPES,
  VALID_MODES,

  // Validation
  isValidSha,
  isValidMode,
  isValidObjectType,

  // Hash utilities
  calculateSha1,
  calculateObjectHash,
  createObjectHeader,
  parseObjectHeader,
  bytesToHex,
  hexToBytes,

  // Loose object format
  compressObject,
  decompressObject,
  writeLooseObject,
  readLooseObject,

  // Object type detection
  detectObjectType,
  parseGitObject,
  createGitObject,
} from './objects'

// =============================================================================
// Pack File Format
// =============================================================================

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

  // Delta operations
  applyDelta,
  createDelta,
  parseDeltaHeader,
  encodeDeltaHeader,
  type DeltaInstruction,
  type DeltaHeader,
} from './pack'

// =============================================================================
// Git References
// =============================================================================

export * from './refs'

// =============================================================================
// Git Wire Protocol
// =============================================================================

export * from './protocol'
