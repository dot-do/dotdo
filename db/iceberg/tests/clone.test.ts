/**
 * Tests for DO Clone Operation - Iceberg Copy-on-Write Semantics
 *
 * These tests verify the clone operation creates independent DOs that share
 * data files using Iceberg's copy-on-write semantics.
 *
 * Key behaviors tested:
 * - Clone creates independent DO with new snapshot lineage
 * - Copy-on-write: same data files referenced, no file copying
 * - Snapshot-specific cloning works
 * - Clone provenance tracking (cloned-from reference)
 * - Validation and error handling
 *
 * @module db/iceberg/tests/clone.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  cloneDO,
  getCloneOrigin,
  validateClone,
  type R2BucketLike,
  type R2ObjectLike,
  type IcebergSnapshotManifest,
  type CurrentSnapshot,
  type CloneResult,
} from '../clone'

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Mock R2 bucket for testing
 */
interface MockR2Bucket extends R2BucketLike {
  _storage: Map<string, string>
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

/**
 * Create a mock R2 bucket with in-memory storage
 */
function createMockR2Bucket(): MockR2Bucket {
  const storage = new Map<string, string>()

  const bucket: MockR2Bucket = {
    _storage: storage,
    put: vi.fn(async (key: string, body: ArrayBuffer | string) => {
      const content = typeof body === 'string' ? body : new TextDecoder().decode(body)
      storage.set(key, content)
      return { key }
    }),
    get: vi.fn(async (key: string): Promise<R2ObjectLike | null> => {
      const content = storage.get(key)
      if (!content) return null
      return {
        json: async <T>() => JSON.parse(content) as T,
        text: async () => content,
        arrayBuffer: async () => new TextEncoder().encode(content).buffer,
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const objects: { key: string }[] = []
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects, truncated: false }
    }),
  }

  return bucket
}

/**
 * Create a sample source manifest for testing
 */
function createSourceManifest(doId: string, snapshotId: string): IcebergSnapshotManifest {
  return {
    'format-version': 2,
    'table-uuid': 'source-uuid-1234',
    location: `do/${doId}`,
    'last-updated-ms': Date.now() - 60000, // 1 minute ago
    'last-column-id': 10,
    'current-snapshot-id': snapshotId,
    'parent-snapshot-id': null,
    snapshots: [
      {
        'snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        'timestamp-ms': Date.now() - 60000,
        'manifest-list': `do/${doId}/metadata/manifest-list-${snapshotId}.json`,
        summary: {
          operation: 'append',
          'total-rows': '100',
        },
      },
    ],
    schemas: [
      {
        'schema-id': 0,
        type: 'struct',
        fields: [
          { id: 1, name: 'id', required: true, type: 'string' },
          { id: 2, name: 'name', required: true, type: 'string' },
          { id: 3, name: 'value', required: false, type: 'integer' },
        ],
      },
    ],
    manifests: [
      {
        'manifest-path': `do/${doId}/data/users/snap-${snapshotId}.parquet`,
        'manifest-length': 8192,
        'partition-spec-id': 0,
        content: 0,
        'sequence-number': 1,
        'added-files-count': 1,
        'existing-files-count': 0,
        'deleted-files-count': 0,
        'added-rows-count': 50,
        table: 'users',
        schema: 'CREATE TABLE users (id TEXT, name TEXT, value INT)',
      },
      {
        'manifest-path': `do/${doId}/data/orders/snap-${snapshotId}.parquet`,
        'manifest-length': 4096,
        'partition-spec-id': 0,
        content: 0,
        'sequence-number': 1,
        'added-files-count': 1,
        'existing-files-count': 0,
        'deleted-files-count': 0,
        'added-rows-count': 50,
        table: 'orders',
        schema: 'CREATE TABLE orders (id TEXT, amount DECIMAL)',
      },
    ],
  }
}

/**
 * Set up a source DO in the mock bucket
 */
function setupSourceDO(bucket: MockR2Bucket, doId: string, snapshotId: string): void {
  const manifest = createSourceManifest(doId, snapshotId)

  // Set current snapshot pointer
  bucket._storage.set(
    `do/${doId}/metadata/current.json`,
    JSON.stringify({ current_snapshot_id: snapshotId })
  )

  // Set snapshot manifest
  bucket._storage.set(`do/${doId}/metadata/${snapshotId}.json`, JSON.stringify(manifest))
}

/**
 * Helper to get manifest from mock bucket
 */
async function getManifest(
  bucket: MockR2Bucket,
  doId: string,
  snapshotId: string
): Promise<IcebergSnapshotManifest> {
  const key = `do/${doId}/metadata/${snapshotId}.json`
  const content = bucket._storage.get(key)
  if (!content) {
    throw new Error(`Manifest not found at ${key}`)
  }
  return JSON.parse(content)
}

/**
 * Helper to get current snapshot ID from mock bucket
 */
async function getCurrentSnapshotId(bucket: MockR2Bucket, doId: string): Promise<string> {
  const key = `do/${doId}/metadata/current.json`
  const content = bucket._storage.get(key)
  if (!content) {
    throw new Error(`Current snapshot not found for ${doId}`)
  }
  const current = JSON.parse(content) as CurrentSnapshot
  return current.current_snapshot_id
}

// ============================================================================
// Test Suite
// ============================================================================

describe('DO Clone Operation', () => {
  let bucket: MockR2Bucket
  const sourceDoId = 'source-do-123'
  const targetDoId = 'target-do-456'
  const sourceSnapshotId = '550e8400-e29b-41d4-a716-446655440000'

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
  })

  // ---------------------------------------------------------------------------
  // Test: Clone creates independent DO
  // ---------------------------------------------------------------------------
  describe('clone creates independent DO', () => {
    it('creates new snapshot for target DO', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result.snapshotId).toBeDefined()
      expect(result.snapshotId).not.toBe(sourceSnapshotId)
      // Verify it's a valid UUID format
      expect(result.snapshotId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })

    it('creates manifest with format-version 2', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(manifest['format-version']).toBe(2)
    })

    it('creates manifest with new table-uuid', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      expect(targetManifest['table-uuid']).toBeDefined()
      expect(targetManifest['table-uuid']).not.toBe(sourceManifest['table-uuid'])
    })

    it('creates manifest with correct target location', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(manifest.location).toBe(`do/${targetDoId}`)
    })

    it('creates manifest with null parent-snapshot-id (new lineage)', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(manifest['parent-snapshot-id']).toBeNull()
    })

    it('updates current.json for target DO', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const currentSnapshotId = await getCurrentSnapshotId(bucket, targetDoId)

      expect(currentSnapshotId).toBe(result.snapshotId)
    })

    it('creates fresh snapshot history with single entry', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(manifest.snapshots).toHaveLength(1)
      expect(manifest.snapshots[0]['snapshot-id']).toBe(result.snapshotId)
      expect(manifest.snapshots[0]['parent-snapshot-id']).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Copy-on-write (fast clone without copying Parquet files)
  // ---------------------------------------------------------------------------
  describe('copy-on-write semantics', () => {
    it('manifests point to SAME data files as source', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      // Both manifests should have same data file paths
      expect(targetManifest.manifests).toHaveLength(sourceManifest.manifests.length)
      for (let i = 0; i < targetManifest.manifests.length; i++) {
        expect(targetManifest.manifests[i]['manifest-path']).toBe(
          sourceManifest.manifests[i]['manifest-path']
        )
      }
    })

    it('does not create new Parquet files', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      await cloneDO(bucket, sourceDoId, targetDoId)

      // Check that no data files were written to target's data directory
      const writtenKeys = Array.from(bucket._storage.keys())
      const targetDataKeys = writtenKeys.filter(
        (k) => k.startsWith(`do/${targetDoId}/data/`)
      )

      expect(targetDataKeys).toHaveLength(0)
    })

    it('only writes metadata files (no data copying)', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      await cloneDO(bucket, sourceDoId, targetDoId)

      // Only metadata files should be written
      const writtenKeys = Array.from(bucket._storage.keys()).filter((k) =>
        k.startsWith(`do/${targetDoId}/`)
      )

      expect(writtenKeys.every((k) => k.includes('/metadata/'))).toBe(true)
    })

    it('returns correct manifest count', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result.manifestCount).toBe(2) // users and orders tables
    })

    it('returns correct row count', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result.rowCount).toBe(100) // 50 + 50 from two tables
    })

    it('copies schema definitions', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      expect(targetManifest.schemas).toEqual(sourceManifest.schemas)
    })

    it('preserves last-column-id', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      expect(targetManifest['last-column-id']).toBe(sourceManifest['last-column-id'])
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Snapshot-specific clone
  // ---------------------------------------------------------------------------
  describe('snapshot-specific clone', () => {
    it('clones current snapshot by default', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result.sourceRef.sourceSnapshotId).toBe(sourceSnapshotId)
    })

    it('clones specific snapshot when provided', async () => {
      const olderSnapshotId = '440e8400-e29b-41d4-a716-446655440000'

      // Set up source with current and historical snapshots
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      // Add an older snapshot
      const olderManifest = createSourceManifest(sourceDoId, olderSnapshotId)
      olderManifest.manifests = [olderManifest.manifests[0]] // Only users table in older version
      olderManifest.manifests[0]['added-rows-count'] = 25
      bucket._storage.set(
        `do/${sourceDoId}/metadata/${olderSnapshotId}.json`,
        JSON.stringify(olderManifest)
      )

      const result = await cloneDO(bucket, sourceDoId, targetDoId, {
        snapshotId: olderSnapshotId,
      })

      expect(result.sourceRef.sourceSnapshotId).toBe(olderSnapshotId)
      expect(result.manifestCount).toBe(1) // Only users table
      expect(result.rowCount).toBe(25)
    })

    it('throws error for non-existent snapshot', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      await expect(
        cloneDO(bucket, sourceDoId, targetDoId, {
          snapshotId: 'nonexistent-snapshot-id',
        })
      ).rejects.toThrow('Source snapshot not found')
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Clone provenance tracking
  // ---------------------------------------------------------------------------
  describe('clone provenance tracking', () => {
    it('stores cloned-from reference in manifest', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(manifest['cloned-from']).toBeDefined()
      expect(manifest['cloned-from']!.sourceDoId).toBe(sourceDoId)
      expect(manifest['cloned-from']!.sourceSnapshotId).toBe(sourceSnapshotId)
    })

    it('stores clone timestamp', async () => {
      const beforeTime = Date.now()
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const afterTime = Date.now()

      expect(manifest['cloned-from']!.clonedAtMs).toBeGreaterThanOrEqual(beforeTime)
      expect(manifest['cloned-from']!.clonedAtMs).toBeLessThanOrEqual(afterTime)
    })

    it('returns sourceRef in clone result', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result.sourceRef).toBeDefined()
      expect(result.sourceRef.sourceDoId).toBe(sourceDoId)
      expect(result.sourceRef.sourceSnapshotId).toBe(sourceSnapshotId)
      expect(result.sourceRef.clonedAtMs).toBeDefined()
    })

    it('snapshot summary includes clone operation info', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const manifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const snapshot = manifest.snapshots[0]

      expect(snapshot.summary.operation).toBe('clone')
      expect(snapshot.summary['cloned-from-do']).toBe(sourceDoId)
      expect(snapshot.summary['cloned-from-snapshot']).toBe(sourceSnapshotId)
      expect(snapshot.summary['total-rows']).toBe('100')
    })
  })

  // ---------------------------------------------------------------------------
  // Test: getCloneOrigin helper
  // ---------------------------------------------------------------------------
  describe('getCloneOrigin()', () => {
    it('returns clone reference for cloned DO', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)
      await cloneDO(bucket, sourceDoId, targetDoId)

      const origin = await getCloneOrigin(bucket, targetDoId)

      expect(origin).not.toBeNull()
      expect(origin!.sourceDoId).toBe(sourceDoId)
      expect(origin!.sourceSnapshotId).toBe(sourceSnapshotId)
    })

    it('returns null for non-cloned DO', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const origin = await getCloneOrigin(bucket, sourceDoId)

      expect(origin).toBeNull()
    })

    it('returns null for non-existent DO', async () => {
      const origin = await getCloneOrigin(bucket, 'nonexistent-do')

      expect(origin).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Test: validateClone helper
  // ---------------------------------------------------------------------------
  describe('validateClone()', () => {
    it('returns valid=true for valid clone operation', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await validateClone(bucket, sourceDoId, targetDoId)

      expect(result.valid).toBe(true)
      expect(result.sourceSnapshotId).toBe(sourceSnapshotId)
    })

    it('returns valid=false when source DO not found', async () => {
      const result = await validateClone(bucket, 'nonexistent-do', targetDoId)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Source DO not found')
    })

    it('returns valid=false when source snapshot not found', async () => {
      // Set up current.json but not the actual manifest
      bucket._storage.set(
        `do/${sourceDoId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: sourceSnapshotId })
      )

      const result = await validateClone(bucket, sourceDoId, targetDoId)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Source snapshot not found')
    })

    it('validates specific snapshot when provided', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await validateClone(bucket, sourceDoId, targetDoId, {
        snapshotId: 'nonexistent-snapshot',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Source snapshot not found')
    })

    it('returns source snapshot ID on success', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await validateClone(bucket, sourceDoId, targetDoId)

      expect(result.sourceSnapshotId).toBe(sourceSnapshotId)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('throws error when source DO not found', async () => {
      await expect(cloneDO(bucket, 'nonexistent-do', targetDoId)).rejects.toThrow(
        'Source DO not found'
      )
    })

    it('throws error when source snapshot not found', async () => {
      // Set up current.json but not the actual manifest
      bucket._storage.set(
        `do/${sourceDoId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: sourceSnapshotId })
      )

      await expect(cloneDO(bucket, sourceDoId, targetDoId)).rejects.toThrow(
        'Source snapshot not found'
      )
    })

    it('handles R2 put failure', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)
      bucket.put.mockRejectedValueOnce(new Error('R2 unavailable'))

      await expect(cloneDO(bucket, sourceDoId, targetDoId)).rejects.toThrow('R2 unavailable')
    })

    it('handles empty manifests array', async () => {
      // Set up source with empty manifests
      const emptyManifest: IcebergSnapshotManifest = {
        'format-version': 2,
        'table-uuid': 'source-uuid',
        location: `do/${sourceDoId}`,
        'last-updated-ms': Date.now(),
        'last-column-id': 0,
        'current-snapshot-id': sourceSnapshotId,
        'parent-snapshot-id': null,
        snapshots: [
          {
            'snapshot-id': sourceSnapshotId,
            'parent-snapshot-id': null,
            'timestamp-ms': Date.now(),
            'manifest-list': '',
            summary: { operation: 'append' },
          },
        ],
        schemas: [],
        manifests: [],
      }

      bucket._storage.set(
        `do/${sourceDoId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: sourceSnapshotId })
      )
      bucket._storage.set(
        `do/${sourceDoId}/metadata/${sourceSnapshotId}.json`,
        JSON.stringify(emptyManifest)
      )

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result.manifestCount).toBe(0)
      expect(result.rowCount).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Multiple clones
  // ---------------------------------------------------------------------------
  describe('multiple clones', () => {
    it('can clone same source to multiple targets', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result1 = await cloneDO(bucket, sourceDoId, 'target-1')
      const result2 = await cloneDO(bucket, sourceDoId, 'target-2')
      const result3 = await cloneDO(bucket, sourceDoId, 'target-3')

      // All clones should have different snapshot IDs
      expect(result1.snapshotId).not.toBe(result2.snapshotId)
      expect(result2.snapshotId).not.toBe(result3.snapshotId)
      expect(result1.snapshotId).not.toBe(result3.snapshotId)

      // All clones should reference same source
      expect(result1.sourceRef.sourceDoId).toBe(sourceDoId)
      expect(result2.sourceRef.sourceDoId).toBe(sourceDoId)
      expect(result3.sourceRef.sourceDoId).toBe(sourceDoId)
    })

    it('can chain clones (clone of clone)', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      // First clone
      const clone1 = await cloneDO(bucket, sourceDoId, 'clone-level-1')

      // Clone the clone
      const clone2 = await cloneDO(bucket, 'clone-level-1', 'clone-level-2')

      // Second clone should reference the first clone, not original
      expect(clone2.sourceRef.sourceDoId).toBe('clone-level-1')
      expect(clone2.sourceRef.sourceSnapshotId).toBe(clone1.snapshotId)
    })

    it('allows overwriting existing target', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      // First clone
      const result1 = await cloneDO(bucket, sourceDoId, targetDoId)

      // Clone again to same target (overwrite)
      const result2 = await cloneDO(bucket, sourceDoId, targetDoId)

      expect(result1.snapshotId).not.toBe(result2.snapshotId)

      // Target should now point to new snapshot
      const currentId = await getCurrentSnapshotId(bucket, targetDoId)
      expect(currentId).toBe(result2.snapshotId)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Shallow vs Deep Clone Semantics
  // ---------------------------------------------------------------------------
  describe('shallow clone semantics (copy-on-write)', () => {
    it('clone is O(1) regardless of data size - only writes metadata', async () => {
      // Set up a source with many manifests to simulate large data
      const largeSourceManifest: IcebergSnapshotManifest = {
        'format-version': 2,
        'table-uuid': 'large-source-uuid',
        location: `do/${sourceDoId}`,
        'last-updated-ms': Date.now(),
        'last-column-id': 100,
        'current-snapshot-id': sourceSnapshotId,
        'parent-snapshot-id': null,
        snapshots: [
          {
            'snapshot-id': sourceSnapshotId,
            'parent-snapshot-id': null,
            'timestamp-ms': Date.now(),
            'manifest-list': `do/${sourceDoId}/metadata/manifest-list.json`,
            summary: { operation: 'append', 'total-rows': '10000000' },
          },
        ],
        schemas: [
          {
            'schema-id': 0,
            type: 'struct',
            fields: [{ id: 1, name: 'id', required: true, type: 'string' }],
          },
        ],
        // Simulate 100 parquet files (typical for large dataset)
        manifests: Array.from({ length: 100 }, (_, i) => ({
          'manifest-path': `do/${sourceDoId}/data/table-${i}/part-${i}.parquet`,
          'manifest-length': 1024 * 1024 * 10, // 10MB per file
          'partition-spec-id': 0,
          content: 0 as const,
          'sequence-number': i + 1,
          'added-files-count': 1,
          'existing-files-count': 0,
          'deleted-files-count': 0,
          'added-rows-count': 100000, // 100k rows per file
          table: `table-${i}`,
          schema: 'CREATE TABLE t (id TEXT)',
        })),
      }

      bucket._storage.set(
        `do/${sourceDoId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: sourceSnapshotId })
      )
      bucket._storage.set(
        `do/${sourceDoId}/metadata/${sourceSnapshotId}.json`,
        JSON.stringify(largeSourceManifest)
      )

      const result = await cloneDO(bucket, sourceDoId, targetDoId)

      // Only 2 metadata files should be written (manifest + current pointer)
      const targetKeys = Array.from(bucket._storage.keys()).filter((k) =>
        k.startsWith(`do/${targetDoId}/`)
      )
      expect(targetKeys).toHaveLength(2)
      expect(targetKeys.every((k) => k.includes('/metadata/'))).toBe(true)

      // Despite 100 parquet files (1GB+ total), clone is instant
      expect(result.manifestCount).toBe(100)
      expect(result.rowCount).toBe(10000000) // 100 * 100k
    })

    it('shallow clone shares data file references without duplication', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      // Verify all data paths are identical (shared, not copied)
      const sourcePaths = sourceManifest.manifests.map((m) => m['manifest-path'])
      const targetPaths = targetManifest.manifests.map((m) => m['manifest-path'])

      expect(targetPaths).toEqual(sourcePaths)

      // Verify source paths still reference source DO location (not rewritten)
      // This is the key COW behavior - data files stay in original location
      expect(targetPaths.every((p) => p.includes(`do/${sourceDoId}/`))).toBe(true)
    })

    it('independent lineage allows independent writes after clone', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)

      // Clone has null parent (independent lineage)
      expect(targetManifest['parent-snapshot-id']).toBeNull()
      expect(targetManifest.snapshots[0]['parent-snapshot-id']).toBeNull()

      // Future writes to clone would create new parquet files in target location
      // The clone's location is set to target DO
      expect(targetManifest.location).toBe(`do/${targetDoId}`)
    })

    it('clone metadata is independent from source metadata', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      // table-uuid should be different (independent identity)
      expect(targetManifest['table-uuid']).not.toBe(sourceManifest['table-uuid'])

      // last-updated-ms should be more recent
      expect(targetManifest['last-updated-ms']).toBeGreaterThanOrEqual(
        sourceManifest['last-updated-ms']
      )

      // current-snapshot-id should be different
      expect(targetManifest['current-snapshot-id']).not.toBe(
        sourceManifest['current-snapshot-id']
      )
    })

    it('time-travel capability is preserved on both source and clone', async () => {
      const olderSnapshotId = '330e8400-e29b-41d4-a716-446655440000'

      // Set up source with history
      const sourceManifest = createSourceManifest(sourceDoId, sourceSnapshotId)
      sourceManifest.snapshots.unshift({
        'snapshot-id': olderSnapshotId,
        'parent-snapshot-id': null,
        'timestamp-ms': Date.now() - 120000,
        'manifest-list': `do/${sourceDoId}/metadata/manifest-list-old.json`,
        summary: { operation: 'append', 'total-rows': '50' },
      })
      sourceManifest.snapshots[1]['parent-snapshot-id'] = olderSnapshotId

      bucket._storage.set(
        `do/${sourceDoId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: sourceSnapshotId })
      )
      bucket._storage.set(
        `do/${sourceDoId}/metadata/${sourceSnapshotId}.json`,
        JSON.stringify(sourceManifest)
      )

      // Clone creates fresh history
      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)

      // Source retains its snapshot history (2 snapshots)
      const sourceAfterClone = JSON.parse(
        bucket._storage.get(`do/${sourceDoId}/metadata/${sourceSnapshotId}.json`)!
      ) as IcebergSnapshotManifest
      expect(sourceAfterClone.snapshots).toHaveLength(2)

      // Clone has fresh history (1 snapshot - the clone operation)
      expect(targetManifest.snapshots).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Cross-namespace Cloning
  // ---------------------------------------------------------------------------
  describe('cross-namespace cloning', () => {
    it('clones from one namespace to another', async () => {
      const sourceNs = 'production/payments.do'
      const targetNs = 'staging/payments-copy.do'

      setupSourceDO(bucket, sourceNs, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceNs, targetNs)

      // Verify clone was created in target namespace
      const currentKey = `do/${targetNs}/metadata/current.json`
      expect(bucket._storage.has(currentKey)).toBe(true)

      // Verify provenance tracks cross-namespace origin
      expect(result.sourceRef.sourceDoId).toBe(sourceNs)
    })

    it('handles nested namespaces with special characters', async () => {
      const sourceNs = 'org:acme/env:prod/tenant:customer-123'
      const targetNs = 'org:acme/env:staging/tenant:customer-123-backup'

      setupSourceDO(bucket, sourceNs, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceNs, targetNs)
      const targetManifest = await getManifest(bucket, targetNs, result.snapshotId)

      expect(targetManifest.location).toBe(`do/${targetNs}`)
      expect(result.sourceRef.sourceDoId).toBe(sourceNs)
    })

    it('preserves data file references across namespaces', async () => {
      const sourceNs = 'tenant-a/database.do'
      const targetNs = 'tenant-b/database-copy.do'

      setupSourceDO(bucket, sourceNs, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceNs, targetNs)
      const targetManifest = await getManifest(bucket, targetNs, result.snapshotId)

      // Data files should still reference source namespace (COW semantics)
      const dataPath = targetManifest.manifests[0]['manifest-path']
      expect(dataPath).toContain(`do/${sourceNs}/`)
      expect(dataPath).not.toContain(`do/${targetNs}/`)
    })

    it('validates cross-namespace clone sources', async () => {
      const sourceNs = 'ns-a/source.do'
      const targetNs = 'ns-b/target.do'

      setupSourceDO(bucket, sourceNs, sourceSnapshotId)

      const validation = await validateClone(bucket, sourceNs, targetNs)

      expect(validation.valid).toBe(true)
      expect(validation.sourceSnapshotId).toBe(sourceSnapshotId)
    })

    it('clones across organizational boundaries', async () => {
      // Simulate cloning from one org to another (common in multi-tenant systems)
      const sourceNs = 'org-alpha/region-us/customers.do'
      const targetNs = 'org-beta/region-eu/customers-mirror.do'

      setupSourceDO(bucket, sourceNs, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceNs, targetNs)
      const origin = await getCloneOrigin(bucket, targetNs)

      expect(origin).not.toBeNull()
      expect(origin!.sourceDoId).toBe(sourceNs)

      // Clone is in target org's namespace
      const targetManifest = await getManifest(bucket, targetNs, result.snapshotId)
      expect(targetManifest.location).toBe(`do/${targetNs}`)
    })

    it('supports environment-based cloning (prod to staging)', async () => {
      const prodNs = 'production/api/users.do'
      const stagingNs = 'staging/api/users.do'

      setupSourceDO(bucket, prodNs, sourceSnapshotId)

      const result = await cloneDO(bucket, prodNs, stagingNs)

      // Staging clone should have independent identity
      const stagingManifest = await getManifest(bucket, stagingNs, result.snapshotId)
      const prodManifest = await getManifest(bucket, prodNs, sourceSnapshotId)

      expect(stagingManifest['table-uuid']).not.toBe(prodManifest['table-uuid'])

      // But should track it came from production
      expect(stagingManifest['cloned-from']!.sourceDoId).toBe(prodNs)
    })

    it('handles cloning with URL-safe namespace characters', async () => {
      // Test various namespace formats that might be used in URL routing
      const testCases = [
        { source: 'api.example.com/data', target: 'backup.example.com/data' },
        { source: 'user_123/workspace', target: 'user_456/workspace' },
        { source: '2024/01/archive', target: '2024/02/archive-copy' },
      ]

      for (const { source, target } of testCases) {
        bucket._storage.clear()
        setupSourceDO(bucket, source, sourceSnapshotId)

        const result = await cloneDO(bucket, source, target)

        expect(result.sourceRef.sourceDoId).toBe(source)

        const origin = await getCloneOrigin(bucket, target)
        expect(origin!.sourceDoId).toBe(source)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Metadata Integrity
  // ---------------------------------------------------------------------------
  describe('metadata integrity', () => {
    it('preserves all schema fields during clone', async () => {
      // Set up source with complex schema
      const complexSchemaManifest: IcebergSnapshotManifest = {
        'format-version': 2,
        'table-uuid': 'complex-uuid',
        location: `do/${sourceDoId}`,
        'last-updated-ms': Date.now(),
        'last-column-id': 20,
        'current-snapshot-id': sourceSnapshotId,
        'parent-snapshot-id': null,
        snapshots: [
          {
            'snapshot-id': sourceSnapshotId,
            'parent-snapshot-id': null,
            'timestamp-ms': Date.now(),
            'manifest-list': '',
            summary: { operation: 'append' },
          },
        ],
        schemas: [
          {
            'schema-id': 0,
            type: 'struct',
            fields: [
              { id: 1, name: 'id', required: true, type: 'string' },
              { id: 2, name: 'name', required: true, type: 'string' },
              { id: 3, name: 'email', required: false, type: 'string' },
              { id: 4, name: 'age', required: false, type: 'integer' },
              { id: 5, name: 'balance', required: false, type: 'decimal(10,2)' },
              { id: 6, name: 'tags', required: false, type: 'list<string>' },
              { id: 7, name: 'metadata', required: false, type: 'map<string,string>' },
              { id: 8, name: 'created_at', required: true, type: 'timestamp' },
            ],
          },
          {
            'schema-id': 1,
            type: 'struct',
            fields: [
              { id: 10, name: 'order_id', required: true, type: 'string' },
              { id: 11, name: 'customer_id', required: true, type: 'string' },
              { id: 12, name: 'total', required: true, type: 'decimal(12,2)' },
            ],
          },
        ],
        manifests: [],
      }

      bucket._storage.set(
        `do/${sourceDoId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: sourceSnapshotId })
      )
      bucket._storage.set(
        `do/${sourceDoId}/metadata/${sourceSnapshotId}.json`,
        JSON.stringify(complexSchemaManifest)
      )

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(targetManifest.schemas).toEqual(complexSchemaManifest.schemas)
      expect(targetManifest.schemas).toHaveLength(2)
      expect(targetManifest.schemas[0].fields).toHaveLength(8)
    })

    it('preserves partition-spec-id in manifests', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      for (let i = 0; i < targetManifest.manifests.length; i++) {
        expect(targetManifest.manifests[i]['partition-spec-id']).toBe(
          sourceManifest.manifests[i]['partition-spec-id']
        )
      }
    })

    it('preserves sequence numbers in manifests', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      for (let i = 0; i < targetManifest.manifests.length; i++) {
        expect(targetManifest.manifests[i]['sequence-number']).toBe(
          sourceManifest.manifests[i]['sequence-number']
        )
      }
    })

    it('preserves file counts in manifest entries', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)
      const sourceManifest = await getManifest(bucket, sourceDoId, sourceSnapshotId)

      for (let i = 0; i < targetManifest.manifests.length; i++) {
        expect(targetManifest.manifests[i]['added-files-count']).toBe(
          sourceManifest.manifests[i]['added-files-count']
        )
        expect(targetManifest.manifests[i]['existing-files-count']).toBe(
          sourceManifest.manifests[i]['existing-files-count']
        )
        expect(targetManifest.manifests[i]['deleted-files-count']).toBe(
          sourceManifest.manifests[i]['deleted-files-count']
        )
      }
    })

    it('preserves table names in manifests', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(targetManifest.manifests[0].table).toBe('users')
      expect(targetManifest.manifests[1].table).toBe('orders')
    })

    it('preserves schema DDL in manifests', async () => {
      setupSourceDO(bucket, sourceDoId, sourceSnapshotId)

      const result = await cloneDO(bucket, sourceDoId, targetDoId)
      const targetManifest = await getManifest(bucket, targetDoId, result.snapshotId)

      expect(targetManifest.manifests[0].schema).toContain('CREATE TABLE users')
      expect(targetManifest.manifests[1].schema).toContain('CREATE TABLE orders')
    })
  })
})
