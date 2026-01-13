/**
 * DO Clone Operation - Iceberg Copy-on-Write Semantics
 *
 * Implements fast cloning of Durable Objects using Iceberg copy-on-write (COW)
 * semantics. Instead of copying Parquet files, the clone operation creates a
 * new manifest that points to the SAME data files as the source DO.
 *
 * Key benefits:
 * - O(1) clone operation regardless of data size
 * - No Parquet file duplication
 * - Independent snapshot lineage for target DO
 * - Full time-travel capability on both source and target
 *
 * Copy-on-write ensures that the cloned DO and source DO share data files
 * until one of them makes modifications. Writes to either DO create new
 * Parquet files, preserving the original shared files.
 *
 * @module db/iceberg/clone
 */

import type { R2Bucket } from '@cloudflare/workers-types'

// ============================================================================
// Types
// ============================================================================

/**
 * R2 bucket interface for cloning operations.
 * Simplified for typing - actual R2Bucket has more methods.
 */
export interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[]; truncated: boolean }>
}

/**
 * R2 object interface for reading metadata.
 */
export interface R2ObjectLike {
  json<T>(): Promise<T>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * SQL storage interface for libSQL operations.
 * Matches Cloudflare SqlStorage interface.
 */
export interface SqlStorageLike {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[]; raw?(): unknown[] }
}

/**
 * Reference to source snapshot for clone tracking.
 * Stored in the cloned manifest for provenance.
 */
export interface CloneReference {
  /** Source DO identifier */
  sourceDoId: string
  /** Source snapshot ID that was cloned */
  sourceSnapshotId: string
  /** Timestamp when clone was created */
  clonedAtMs: number
}

/**
 * Manifest file entry in Iceberg format.
 */
export interface ManifestFileEntry {
  /** Path to the data file */
  'manifest-path': string
  /** Length in bytes */
  'manifest-length': number
  /** Partition spec ID */
  'partition-spec-id': number
  /** Content type: 0 = data, 1 = delete */
  content: 0 | 1
  /** Sequence number */
  'sequence-number': number
  /** Files added count */
  'added-files-count': number
  /** Files existing count */
  'existing-files-count': number
  /** Files deleted count */
  'deleted-files-count': number
  /** Rows added count */
  'added-rows-count': number
  /** Table name */
  table: string
  /** Schema definition */
  schema: string
}

/**
 * Snapshot entry in Iceberg format.
 */
export interface SnapshotEntry {
  /** Unique snapshot ID */
  'snapshot-id': string
  /** Parent snapshot ID (null for new lineage) */
  'parent-snapshot-id': string | null
  /** Creation timestamp */
  'timestamp-ms': number
  /** Path to manifest list */
  'manifest-list': string
  /** Operation summary */
  summary: Record<string, string>
}

/**
 * Schema field entry.
 */
export interface SchemaField {
  /** Field ID */
  id: number
  /** Field name */
  name: string
  /** Whether field is required */
  required: boolean
  /** Field type */
  type: string
}

/**
 * Schema entry in Iceberg format.
 */
export interface SchemaEntry {
  /** Schema ID */
  'schema-id': number
  /** Type (always 'struct' for table schemas) */
  type: 'struct'
  /** Schema fields */
  fields: SchemaField[]
}

/**
 * Iceberg snapshot manifest structure (format v2).
 */
export interface IcebergSnapshotManifest {
  /** Format version (always 2) */
  'format-version': 2
  /** Table UUID */
  'table-uuid': string
  /** Base location */
  location: string
  /** Last updated timestamp */
  'last-updated-ms': number
  /** Last column ID */
  'last-column-id': number
  /** Current snapshot ID */
  'current-snapshot-id': string | null
  /** Parent snapshot ID */
  'parent-snapshot-id': string | null
  /** Clone reference (if cloned from another DO) */
  'cloned-from'?: CloneReference
  /** Snapshot history */
  snapshots: SnapshotEntry[]
  /** Schema definitions */
  schemas: SchemaEntry[]
  /** Manifest file entries */
  manifests: ManifestFileEntry[]
}

/**
 * Current snapshot pointer structure.
 */
export interface CurrentSnapshot {
  /** Current snapshot ID */
  current_snapshot_id: string
}

/**
 * Options for clone operation.
 */
export interface CloneOptions {
  /** Specific snapshot ID to clone (defaults to current snapshot) */
  snapshotId?: string
}

/**
 * Result of clone operation.
 */
export interface CloneResult {
  /** New snapshot ID created for target DO */
  snapshotId: string
  /** Reference to source snapshot */
  sourceRef: CloneReference
  /** Number of manifest entries copied */
  manifestCount: number
  /** Total rows in cloned snapshot */
  rowCount: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates a UUID v4 string.
 * Uses crypto.randomUUID if available, otherwise falls back to manual generation.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Build the R2 key for current snapshot pointer.
 */
function buildCurrentSnapshotKey(doId: string): string {
  return `do/${doId}/metadata/current.json`
}

/**
 * Build the R2 key for a snapshot manifest.
 */
function buildSnapshotKey(doId: string, snapshotId: string): string {
  return `do/${doId}/metadata/${snapshotId}.json`
}

// ============================================================================
// Clone Implementation
// ============================================================================

/**
 * Clone a Durable Object using Iceberg copy-on-write semantics.
 *
 * This function creates a fast clone of a DO by:
 * 1. Reading the source DO's snapshot manifest
 * 2. Creating a new manifest for the target DO that points to the SAME data files
 * 3. Writing the new manifest to R2
 *
 * The clone operation is O(1) regardless of data size because it only copies
 * metadata (manifests), not the actual Parquet data files. Both DOs share
 * the same data files until one of them makes modifications.
 *
 * @param bucket - R2 bucket containing the Iceberg tables
 * @param sourceDoId - Source DO identifier to clone from
 * @param targetDoId - Target DO identifier to clone to
 * @param options - Optional clone options (e.g., specific snapshot to clone)
 * @returns Clone result with new snapshot ID and metadata
 *
 * @example
 * ```typescript
 * // Clone the current state of source DO
 * const result = await cloneDO(bucket, 'payments.do', 'payments-backup.do')
 * console.log(`Cloned to snapshot: ${result.snapshotId}`)
 * console.log(`Cloned ${result.rowCount} rows`)
 *
 * // Clone a specific historical snapshot
 * const historicalClone = await cloneDO(bucket, 'payments.do', 'payments-2024.do', {
 *   snapshotId: '550e8400-e29b-41d4-a716-446655440000'
 * })
 * ```
 */
export async function cloneDO(
  bucket: R2BucketLike | R2Bucket,
  sourceDoId: string,
  targetDoId: string,
  options: CloneOptions = {}
): Promise<CloneResult> {
  const r2 = bucket as R2BucketLike

  // Step 1: Resolve source snapshot ID
  let sourceSnapshotId = options.snapshotId
  if (!sourceSnapshotId) {
    const currentKey = buildCurrentSnapshotKey(sourceDoId)
    const currentObj = await r2.get(currentKey)
    if (!currentObj) {
      throw new Error(`Source DO not found: ${sourceDoId} (no current.json)`)
    }
    const current = await currentObj.json<CurrentSnapshot>()
    sourceSnapshotId = current.current_snapshot_id
  }

  // Step 2: Load source snapshot manifest
  const sourceManifestKey = buildSnapshotKey(sourceDoId, sourceSnapshotId)
  const sourceManifestObj = await r2.get(sourceManifestKey)
  if (!sourceManifestObj) {
    throw new Error(`Source snapshot not found: ${sourceSnapshotId}`)
  }
  const sourceManifest = await sourceManifestObj.json<IcebergSnapshotManifest>()

  // Step 3: Generate new snapshot ID for target
  const newSnapshotId = generateUUID()
  const timestampMs = Date.now()

  // Step 4: Create clone reference for provenance tracking
  const cloneRef: CloneReference = {
    sourceDoId,
    sourceSnapshotId,
    clonedAtMs: timestampMs,
  }

  // Step 5: Calculate total row count from source manifests
  let totalRowCount = 0
  for (const manifest of sourceManifest.manifests) {
    totalRowCount += manifest['added-rows-count'] || 0
  }

  // Step 6: Create new snapshot entry (new lineage, no parent)
  const newSnapshotEntry: SnapshotEntry = {
    'snapshot-id': newSnapshotId,
    'parent-snapshot-id': null, // New lineage starts here
    'timestamp-ms': timestampMs,
    'manifest-list': `do/${targetDoId}/metadata/manifest-list-${newSnapshotId}.json`,
    summary: {
      operation: 'clone',
      'cloned-from-do': sourceDoId,
      'cloned-from-snapshot': sourceSnapshotId,
      'total-rows': String(totalRowCount),
    },
  }

  // Step 7: Create new manifest pointing to SAME data files (copy-on-write)
  // This is the key COW optimization - we don't copy the Parquet files,
  // we just reference the same paths
  const newManifest: IcebergSnapshotManifest = {
    'format-version': 2,
    'table-uuid': generateUUID(), // New UUID for independent table identity
    location: `do/${targetDoId}`,
    'last-updated-ms': timestampMs,
    'last-column-id': sourceManifest['last-column-id'],
    'current-snapshot-id': newSnapshotId,
    'parent-snapshot-id': null, // New lineage
    'cloned-from': cloneRef,
    snapshots: [newSnapshotEntry], // Fresh snapshot history
    schemas: sourceManifest.schemas, // Copy schema definitions
    manifests: sourceManifest.manifests.map((m) => ({
      ...m,
      // Keep pointing to original data files - this is copy-on-write
      // The manifest-path points to the same Parquet files
    })),
  }

  // Step 8: Write new manifest to R2
  const newManifestKey = buildSnapshotKey(targetDoId, newSnapshotId)
  await r2.put(newManifestKey, JSON.stringify(newManifest))

  // Step 9: Update target DO's current snapshot pointer
  const newCurrentKey = buildCurrentSnapshotKey(targetDoId)
  await r2.put(newCurrentKey, JSON.stringify({ current_snapshot_id: newSnapshotId }))

  return {
    snapshotId: newSnapshotId,
    sourceRef: cloneRef,
    manifestCount: newManifest.manifests.length,
    rowCount: totalRowCount,
  }
}

/**
 * Check if a DO was cloned from another DO.
 *
 * Returns the clone reference if the DO's current snapshot was created
 * by a clone operation, or null if it was created normally.
 *
 * @param bucket - R2 bucket containing the Iceberg tables
 * @param doId - DO identifier to check
 * @returns Clone reference if cloned, null otherwise
 *
 * @example
 * ```typescript
 * const cloneRef = await getCloneOrigin(bucket, 'payments-backup.do')
 * if (cloneRef) {
 *   console.log(`Cloned from ${cloneRef.sourceDoId} at ${new Date(cloneRef.clonedAtMs)}`)
 * }
 * ```
 */
export async function getCloneOrigin(
  bucket: R2BucketLike | R2Bucket,
  doId: string
): Promise<CloneReference | null> {
  const r2 = bucket as R2BucketLike

  // Get current snapshot
  const currentKey = buildCurrentSnapshotKey(doId)
  const currentObj = await r2.get(currentKey)
  if (!currentObj) {
    return null
  }
  const current = await currentObj.json<CurrentSnapshot>()

  // Load manifest
  const manifestKey = buildSnapshotKey(doId, current.current_snapshot_id)
  const manifestObj = await r2.get(manifestKey)
  if (!manifestObj) {
    return null
  }
  const manifest = await manifestObj.json<IcebergSnapshotManifest>()

  return manifest['cloned-from'] || null
}

/**
 * Validate that a clone operation would succeed.
 *
 * Performs pre-flight checks without actually creating the clone:
 * - Verifies source DO exists
 * - Verifies source snapshot exists (if specified)
 * - Verifies target DO doesn't already exist (optional)
 *
 * @param bucket - R2 bucket containing the Iceberg tables
 * @param sourceDoId - Source DO identifier
 * @param targetDoId - Target DO identifier
 * @param options - Clone options
 * @returns Object with validation result and any error message
 *
 * @example
 * ```typescript
 * const validation = await validateClone(bucket, 'source.do', 'target.do')
 * if (!validation.valid) {
 *   console.error(`Clone validation failed: ${validation.error}`)
 * }
 * ```
 */
export async function validateClone(
  bucket: R2BucketLike | R2Bucket,
  sourceDoId: string,
  targetDoId: string,
  options: CloneOptions = {}
): Promise<{ valid: boolean; error?: string; sourceSnapshotId?: string }> {
  const r2 = bucket as R2BucketLike

  // Check source exists
  const sourceCurrentKey = buildCurrentSnapshotKey(sourceDoId)
  const sourceCurrentObj = await r2.get(sourceCurrentKey)
  if (!sourceCurrentObj) {
    return { valid: false, error: `Source DO not found: ${sourceDoId}` }
  }

  // Get source snapshot ID
  const sourceCurrent = await sourceCurrentObj.json<CurrentSnapshot>()
  const sourceSnapshotId = options.snapshotId || sourceCurrent.current_snapshot_id

  // Verify source snapshot exists
  const sourceManifestKey = buildSnapshotKey(sourceDoId, sourceSnapshotId)
  const sourceManifestObj = await r2.get(sourceManifestKey)
  if (!sourceManifestObj) {
    return { valid: false, error: `Source snapshot not found: ${sourceSnapshotId}` }
  }

  // Check target doesn't already exist (optional - could be overwrite)
  const targetCurrentKey = buildCurrentSnapshotKey(targetDoId)
  const targetCurrentObj = await r2.get(targetCurrentKey)
  if (targetCurrentObj) {
    // Target exists - this could be intentional (overwrite clone)
    // For now, we allow this but the caller can check and handle
  }

  return { valid: true, sourceSnapshotId }
}
