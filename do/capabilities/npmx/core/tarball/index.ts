/**
 * Tarball handling for npm packages
 *
 * Provides compression, extraction, creation, and integrity verification
 * for npm package tarballs.
 *
 * This module has ZERO Cloudflare dependencies.
 *
 * @module core/tarball
 */

// Re-export types
export type {
  TarEntry,
  TarHeader,
  TarEntryType,
  SparseRegion,
  ExtractOptions,
  CreateOptions,
  IntegrityHash,
  HashAlgorithm,
  VirtualFS,
  PaxExtendedHeader,
} from './types'

export { TAR_BLOCK_SIZE, GZIP_MAGIC, TYPE_FLAGS } from './types'

// Decompression
export { decompress, compress, isGzipData } from './decompress'

// Tar parsing
export {
  parseTarHeader,
  parsePaxHeaders,
  createTarHeader,
  createPaxHeader,
  padToBlockSize,
  createEndOfArchive,
} from './tar'

// Extraction
export { extractTarball, streamExtractTarball } from './extract'

// Creation
export {
  createTarball,
  streamCreateTarball,
  createSingleFileTarball,
  createSymlinkTarball,
  createHardlinkTarball,
  createDirectoryTarball,
} from './create'

// Integrity
export {
  calculateIntegrity,
  verifyIntegrity,
  parseIntegrity,
  createMultipleIntegrity,
  getStrongestHash,
  integrityEquals,
  IntegrityStream,
} from './integrity'
