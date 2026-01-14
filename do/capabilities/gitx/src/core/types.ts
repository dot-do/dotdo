/**
 * @fileoverview Core Type Definitions (Platform Agnostic)
 *
 * This module defines the storage abstraction interfaces and common types
 * used throughout the core git implementation. These interfaces are designed
 * to be implemented by platform-specific backends (Node.js fs, Cloudflare R2, etc.)
 *
 * This module has ZERO Cloudflare dependencies and can run in any JavaScript runtime.
 *
 * @module core/types
 */

import type { CommitObject, TreeObject, ObjectType } from './objects'
import type { Ref } from './refs'

// ============================================================================
// Storage Interfaces
// ============================================================================

/**
 * Result of retrieving a Git object from storage.
 */
export interface StoredObjectResult {
  /** The type of Git object */
  type: ObjectType
  /** Raw binary content of the object (excluding Git header) */
  data: Uint8Array
}

/**
 * Basic object store interface for core operations.
 *
 * This is the minimal interface needed for object storage.
 */
export interface BasicObjectStore {
  /**
   * Retrieve a Git object by its SHA-1 hash.
   */
  getObject(sha: string): Promise<StoredObjectResult | null>

  /**
   * Store a Git object and return its SHA-1 hash.
   */
  storeObject(type: ObjectType, data: Uint8Array): Promise<string>

  /**
   * Check if an object exists in the store.
   */
  hasObject(sha: string): Promise<boolean>
}

/**
 * Object store with reference management capabilities.
 */
export interface RefObjectStore extends BasicObjectStore {
  /**
   * Get a reference by its name.
   */
  getRef(refName: string): Promise<string | null>

  /**
   * Set a reference to point to a SHA.
   */
  setRef(refName: string, sha: string): Promise<void>

  /**
   * Delete a reference.
   */
  deleteRef(refName: string): Promise<boolean>

  /**
   * List references with a given prefix.
   */
  listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>>
}

/**
 * Object store specialized for tree diff operations.
 */
export interface TreeDiffObjectStore {
  /**
   * Get a tree object by SHA.
   */
  getTree(sha: string): Promise<TreeObject | null>

  /**
   * Get blob content by SHA.
   */
  getBlob(sha: string): Promise<Uint8Array | null>

  /**
   * Check if an object exists.
   */
  exists(sha: string): Promise<boolean>
}

/**
 * Full-featured object store interface.
 */
export interface ObjectStore extends RefObjectStore, TreeDiffObjectStore {
  // Combined from RefObjectStore and TreeDiffObjectStore
}

/**
 * Interface for retrieving commits from storage.
 */
export interface CommitProvider {
  /**
   * Get a commit by SHA.
   */
  getCommit(sha: string): Promise<CommitObject | null>

  /**
   * Get commits that modify a specific path (optional).
   */
  getCommitsForPath?(path: string): Promise<string[]>

  /**
   * Get the tree for a commit (optional).
   */
  getTree?(commitSha: string): Promise<unknown>
}

/**
 * Minimal commit provider interface.
 */
export interface BasicCommitProvider {
  /**
   * Get a commit by SHA.
   */
  getCommit(sha: string): Promise<CommitObject | null>
}

// ============================================================================
// Storage Backend Interface
// ============================================================================

/**
 * Low-level storage backend interface.
 *
 * This interface abstracts over different storage implementations
 * (file system, Cloudflare R2, SQLite, etc.) and provides a unified API.
 */
export interface StorageBackend {
  // Content-Addressable Storage (CAS) Operations

  /**
   * Store a Git object and return its SHA-1 hash.
   */
  putObject(type: ObjectType, content: Uint8Array): Promise<string>

  /**
   * Retrieve a Git object by its SHA-1 hash.
   */
  getObject(sha: string): Promise<StoredObjectResult | null>

  /**
   * Check if a Git object exists in storage.
   */
  hasObject(sha: string): Promise<boolean>

  /**
   * Delete a Git object from storage.
   */
  deleteObject(sha: string): Promise<void>

  // Reference Operations

  /**
   * Get a reference by name.
   */
  getRef(name: string): Promise<Ref | null>

  /**
   * Create or update a reference.
   */
  setRef(name: string, ref: Ref): Promise<void>

  /**
   * Delete a reference.
   */
  deleteRef(name: string): Promise<void>

  /**
   * List references matching an optional prefix.
   */
  listRefs(prefix?: string): Promise<Ref[]>

  // Raw File Operations

  /**
   * Read a raw file from the repository.
   */
  readFile(path: string): Promise<Uint8Array | null>

  /**
   * Write a raw file to the repository.
   */
  writeFile(path: string, content: Uint8Array): Promise<void>

  /**
   * Delete a raw file from the repository.
   */
  deleteFile(path: string): Promise<void>

  /**
   * Check if a file or directory exists.
   */
  exists(path: string): Promise<boolean>

  // Directory Operations

  /**
   * List contents of a directory.
   */
  readdir(path: string): Promise<string[]>

  /**
   * Create a directory.
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

// ============================================================================
// Hash Function Interface
// ============================================================================

/**
 * Interface for SHA-1 hashing.
 *
 * This allows different runtime implementations (Web Crypto, Node.js crypto, etc.)
 */
export interface HashFunction {
  /**
   * Compute SHA-1 hash of data.
   * @returns 40-character lowercase hexadecimal string
   */
  sha1(data: Uint8Array): Promise<string>

  /**
   * Compute SHA-1 hash synchronously (if available).
   */
  sha1Sync?(data: Uint8Array): string
}

// ============================================================================
// Compression Interface
// ============================================================================

/**
 * Interface for zlib compression/decompression.
 *
 * This allows different runtime implementations (pako, Node.js zlib, etc.)
 */
export interface CompressionProvider {
  /**
   * Deflate (compress) data.
   */
  deflate(data: Uint8Array): Promise<Uint8Array>

  /**
   * Inflate (decompress) data.
   */
  inflate(data: Uint8Array): Promise<Uint8Array>

  /**
   * Synchronous deflate (if available).
   */
  deflateSync?(data: Uint8Array): Uint8Array

  /**
   * Synchronous inflate (if available).
   */
  inflateSync?(data: Uint8Array): Uint8Array
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Standard validation result.
 */
export interface ValidationResult {
  isValid: boolean
  error?: string
}

/**
 * Operation result with optional error.
 */
export interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Options for walk operations.
 */
export interface WalkOptions {
  /** Maximum depth to traverse (-1 for unlimited) */
  maxDepth?: number
  /** Filter function for entries */
  filter?: (entry: { path: string; type: string }) => boolean
}

/**
 * File entry for tree walking.
 */
export interface FileEntry {
  /** Path relative to repository root */
  path: string
  /** File mode string */
  mode: string
  /** SHA-1 of the blob */
  sha: string
  /** Object type ('blob' or 'tree') */
  type: 'blob' | 'tree'
}

/**
 * Diff entry between two trees.
 */
export interface DiffEntry {
  /** Path relative to repository root */
  path: string
  /** Old file SHA (null if added) */
  oldSha: string | null
  /** New file SHA (null if deleted) */
  newSha: string | null
  /** Old file mode (null if added) */
  oldMode: string | null
  /** New file mode (null if deleted) */
  newMode: string | null
  /** Type of change */
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'
  /** For renames/copies: similarity percentage */
  similarity?: number
  /** For renames/copies: old path */
  oldPath?: string
}
