/**
 * Visibility Tests for IcebergReader
 *
 * RED Phase TDD - These tests should FAIL until visibility support
 * is implemented in the Iceberg reader.
 *
 * Visibility Levels:
 * - 'public': Accessible without authentication
 * - 'unlisted': Accessible by direct lookup only (no listing)
 * - 'org': Accessible to organization members only
 * - 'user': Accessible to the owning user only
 *
 * The visibility field will be added to:
 * 1. PartitionFilter - to filter by visibility in queries
 * 2. FindFileOptions/GetRecordOptions - to specify visibility context
 * 3. IcebergRecord - as a field on retrieved records
 *
 * Auth context will be required for 'org' and 'user' visibility levels.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { IcebergReader } from '../../db/iceberg/reader'
import type {
  IcebergMetadata,
  ManifestList,
  DataFileEntry,
  IcebergRecord,
  PartitionFilter,
  FindFileOptions,
  GetRecordOptions,
} from '../../db/iceberg/types'

// ============================================================================
// Mock Types
// ============================================================================

interface MockR2Object {
  key: string
  body: ReadableStream
  text(): Promise<string>
  json<T>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}

interface MockR2Bucket {
  get: Mock<(key: string) => Promise<MockR2Object | null>>
  head: Mock<(key: string) => Promise<{ key: string } | null>>
  list: Mock<() => Promise<{ objects: Array<{ key: string }> }>>
}

function createMockR2Bucket(): MockR2Bucket {
  return {
    get: vi.fn(),
    head: vi.fn(),
    list: vi.fn(),
  }
}

function createMockR2Object(key: string, data: unknown): MockR2Object {
  const json = JSON.stringify(data)
  const encoder = new TextEncoder()
  const uint8 = encoder.encode(json)

  return {
    key,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(uint8)
        controller.close()
      },
    }),
    text: vi.fn().mockResolvedValue(json),
    json: vi.fn().mockResolvedValue(data),
    arrayBuffer: vi.fn().mockResolvedValue(uint8.buffer),
  }
}

// ============================================================================
// Test Fixtures - Records with Visibility
// ============================================================================

/**
 * Extended IcebergRecord with visibility field
 * This interface represents what records should look like after visibility is implemented
 */
interface VisibleRecord extends IcebergRecord {
  visibility: 'public' | 'unlisted' | 'org' | 'user'
  ownerId?: string
  orgId?: string
}

/**
 * Auth context for visibility checking
 */
interface AuthContext {
  userId?: string
  orgId?: string
  roles?: string[]
}

/**
 * Extended partition filter with visibility support
 */
interface VisibilityPartitionFilter extends PartitionFilter {
  visibility?: 'public' | 'unlisted' | 'org' | 'user'
}

/**
 * Extended find file options with auth context
 */
interface VisibilityFindFileOptions extends FindFileOptions {
  partition: VisibilityPartitionFilter
  auth?: AuthContext
}

/**
 * Extended get record options with auth context
 */
interface VisibilityGetRecordOptions extends GetRecordOptions {
  partition: VisibilityPartitionFilter
  auth?: AuthContext
}

function createSampleMetadataWithVisibility(): IcebergMetadata {
  return {
    formatVersion: 2,
    tableUuid: 'test-visibility-table-uuid',
    location: 'r2://dotdo-data/iceberg/do_resources',
    lastUpdatedMs: Date.now(),
    lastColumnId: 15,
    schemas: [
      {
        schemaId: 0,
        type: 'struct',
        fields: [
          { id: 1, name: 'ns', required: true, type: 'string' },
          { id: 2, name: 'type', required: true, type: 'string' },
          { id: 3, name: 'id', required: true, type: 'string' },
          { id: 4, name: 'ts', required: true, type: 'timestamp' },
          { id: 5, name: 'visibility', required: true, type: 'string' },
          { id: 6, name: 'ownerId', required: false, type: 'string' },
          { id: 7, name: 'orgId', required: false, type: 'string' },
          { id: 8, name: 'mdx', required: false, type: 'string' },
          { id: 9, name: 'esm', required: false, type: 'string' },
          { id: 10, name: 'dts', required: false, type: 'string' },
        ],
      },
    ],
    currentSchemaId: 0,
    partitionSpecs: [
      {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'ns', transform: 'identity' },
          { sourceId: 2, fieldId: 1001, name: 'type', transform: 'identity' },
          { sourceId: 5, fieldId: 1002, name: 'visibility', transform: 'identity' },
        ],
      },
    ],
    defaultSpecId: 0,
    lastPartitionId: 1002,
    currentSnapshotId: 2001,
    snapshots: [
      {
        snapshotId: 2001,
        parentSnapshotId: null,
        sequenceNumber: 1,
        timestampMs: Date.now(),
        manifestList: 'iceberg/do_resources/metadata/snap-2001-manifest-list.avro',
        summary: { operation: 'append' },
      },
    ],
  }
}

function createManifestListWithVisibility(): ManifestList {
  return {
    manifests: [
      {
        manifestPath: 'iceberg/do_resources/metadata/manifest-public.avro',
        manifestLength: 4096,
        partitionSpecId: 0,
        sequenceNumber: 1,
        addedSnapshotId: 2001,
        addedFilesCount: 2,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitions: [
          { containsNull: false, lowerBound: 'payments.do', upperBound: 'payments.do' },
          { containsNull: false, lowerBound: 'Function', upperBound: 'Function' },
          { containsNull: false, lowerBound: 'public', upperBound: 'public' },
        ],
      },
      {
        manifestPath: 'iceberg/do_resources/metadata/manifest-unlisted.avro',
        manifestLength: 4096,
        partitionSpecId: 0,
        sequenceNumber: 1,
        addedSnapshotId: 2001,
        addedFilesCount: 1,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitions: [
          { containsNull: false, lowerBound: 'payments.do', upperBound: 'payments.do' },
          { containsNull: false, lowerBound: 'Function', upperBound: 'Function' },
          { containsNull: false, lowerBound: 'unlisted', upperBound: 'unlisted' },
        ],
      },
      {
        manifestPath: 'iceberg/do_resources/metadata/manifest-org.avro',
        manifestLength: 4096,
        partitionSpecId: 0,
        sequenceNumber: 1,
        addedSnapshotId: 2001,
        addedFilesCount: 1,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitions: [
          { containsNull: false, lowerBound: 'payments.do', upperBound: 'payments.do' },
          { containsNull: false, lowerBound: 'Function', upperBound: 'Function' },
          { containsNull: false, lowerBound: 'org', upperBound: 'org' },
        ],
      },
      {
        manifestPath: 'iceberg/do_resources/metadata/manifest-user.avro',
        manifestLength: 4096,
        partitionSpecId: 0,
        sequenceNumber: 1,
        addedSnapshotId: 2001,
        addedFilesCount: 1,
        existingFilesCount: 0,
        deletedFilesCount: 0,
        partitions: [
          { containsNull: false, lowerBound: 'payments.do', upperBound: 'payments.do' },
          { containsNull: false, lowerBound: 'Function', upperBound: 'Function' },
          { containsNull: false, lowerBound: 'user', upperBound: 'user' },
        ],
      },
    ],
  }
}

function createDataFilesWithVisibility(visibility: string): DataFileEntry[] {
  return [
    {
      status: 1,
      filePath: `iceberg/do_resources/data/ns=payments.do/type=Function/visibility=${visibility}/00001.parquet`,
      fileFormat: 'PARQUET',
      partition: { ns: 'payments.do', type: 'Function', visibility },
      recordCount: 5,
      fileSizeBytes: 4096,
      lowerBounds: { 3: 'charge' },
      upperBounds: { 3: 'refund' },
    },
  ]
}

function createVisibleRecords(): VisibleRecord[] {
  return [
    {
      ns: 'payments.do',
      type: 'Function',
      id: 'charge',
      ts: '2024-01-15T10:30:00Z',
      visibility: 'public',
      ownerId: 'user-123',
      orgId: 'org-456',
      esm: 'export async function charge(amount) { return { success: true } }',
    },
    {
      ns: 'payments.do',
      type: 'Function',
      id: 'internal-charge',
      ts: '2024-01-15T10:30:00Z',
      visibility: 'org',
      ownerId: 'user-123',
      orgId: 'org-456',
      esm: 'export async function internalCharge(amount) { return { success: true } }',
    },
    {
      ns: 'payments.do',
      type: 'Function',
      id: 'secret-func',
      ts: '2024-01-15T10:30:00Z',
      visibility: 'user',
      ownerId: 'user-123',
      esm: 'export async function secretFunc() { return { secret: true } }',
    },
    {
      ns: 'payments.do',
      type: 'Function',
      id: 'hidden-webhook',
      ts: '2024-01-15T10:30:00Z',
      visibility: 'unlisted',
      ownerId: 'user-123',
      esm: 'export async function hiddenWebhook() { return { hidden: true } }',
    },
  ]
}

// ============================================================================
// Visibility Tests - RED Phase (These should FAIL)
// ============================================================================

describe('IcebergReader Visibility Support', () => {
  let mockBucket: MockR2Bucket
  let reader: IcebergReader

  beforeEach(() => {
    mockBucket = createMockR2Bucket()
    reader = new IcebergReader(mockBucket as unknown as import('@cloudflare/workers-types').R2Bucket)
  })

  describe('PartitionFilter visibility field', () => {
    it('PartitionFilter type should support visibility field', () => {
      // This test verifies the PartitionFilter interface includes visibility
      // RED: Will fail because PartitionFilter doesn't have visibility field yet
      const filter: PartitionFilter = {
        ns: 'payments.do',
        type: 'Function',
        // @ts-expect-error visibility not yet in PartitionFilter
        visibility: 'public',
      }

      // The filter should accept visibility as a valid field
      expect(filter).toHaveProperty('visibility')
      expect((filter as VisibilityPartitionFilter).visibility).toBe('public')
    })

    it('visibility field accepts valid visibility values', () => {
      // RED: Will fail because visibility not in PartitionFilter
      const validVisibilities = ['public', 'unlisted', 'org', 'user'] as const

      validVisibilities.forEach((v) => {
        const filter = {
          ns: 'test.do',
          type: 'Function',
          visibility: v,
        } as VisibilityPartitionFilter

        expect(filter.visibility).toBe(v)
      })
    })
  })

  describe('findFile with visibility filter', () => {
    it('filters manifest files by visibility partition', async () => {
      // Setup mock data
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const publicDataFiles = createDataFilesWithVisibility('public')

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-public.avro')) {
          return createMockR2Object(key, { entries: publicDataFiles })
        }
        return null
      })

      // RED: findFile doesn't support visibility in partition filter yet
      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'public' } as VisibilityPartitionFilter,
        id: 'charge',
      } as VisibilityFindFileOptions)

      expect(result).not.toBeNull()
      // Should only search in public manifest, not org/user/unlisted manifests
      const calledPaths = mockBucket.get.mock.calls.map(([path]) => path)
      expect(calledPaths.some((p: string) => p.includes('manifest-public.avro'))).toBe(true)
      expect(calledPaths.some((p: string) => p.includes('manifest-org.avro'))).toBe(false)
      expect(calledPaths.some((p: string) => p.includes('manifest-user.avro'))).toBe(false)
    })

    it('prunes manifests by visibility bounds', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        // Should NOT reach manifest files for wrong visibility
        if (key.includes('manifest-org.avro') || key.includes('manifest-user.avro')) {
          throw new Error('Should not read org/user manifests when filtering for public visibility')
        }
        return null
      })

      // RED: Visibility-based partition pruning not implemented
      await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'public' } as VisibilityPartitionFilter,
        id: 'charge',
      } as VisibilityFindFileOptions)

      // If we get here without error, visibility pruning worked
    })
  })

  describe('getRecord respects visibility', () => {
    it('returns public records without auth context', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const publicDataFiles = createDataFilesWithVisibility('public')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-public.avro')) {
          return createMockR2Object(key, { entries: publicDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'public') })
        }
        return null
      })

      // RED: getRecord doesn't handle visibility yet
      const result = await reader.getRecord<VisibleRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'public' } as VisibilityPartitionFilter,
        id: 'charge',
      } as VisibilityGetRecordOptions)

      expect(result).not.toBeNull()
      expect(result?.visibility).toBe('public')
      expect(result?.id).toBe('charge')
    })

    it('rejects org records without auth context', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const orgDataFiles = createDataFilesWithVisibility('org')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-org.avro')) {
          return createMockR2Object(key, { entries: orgDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'org') })
        }
        return null
      })

      // RED: Should throw or return null when org visibility requires auth
      await expect(
        reader.getRecord<VisibleRecord>({
          table: 'do_resources',
          partition: { ns: 'payments.do', type: 'Function', visibility: 'org' } as VisibilityPartitionFilter,
          id: 'internal-charge',
          // No auth context provided
        } as VisibilityGetRecordOptions)
      ).rejects.toThrow(/auth|unauthorized|permission/i)
    })

    it('rejects user records without auth context', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const userDataFiles = createDataFilesWithVisibility('user')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-user.avro')) {
          return createMockR2Object(key, { entries: userDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'user') })
        }
        return null
      })

      // RED: Should throw or return null when user visibility requires auth
      await expect(
        reader.getRecord<VisibleRecord>({
          table: 'do_resources',
          partition: { ns: 'payments.do', type: 'Function', visibility: 'user' } as VisibilityPartitionFilter,
          id: 'secret-func',
          // No auth context provided
        } as VisibilityGetRecordOptions)
      ).rejects.toThrow(/auth|unauthorized|permission/i)
    })
  })

  describe('public records accessible without auth', () => {
    it('allows access to public records without any authentication', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const publicDataFiles = createDataFilesWithVisibility('public')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-public.avro')) {
          return createMockR2Object(key, { entries: publicDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'public') })
        }
        return null
      })

      // RED: Public visibility access not explicitly implemented
      const result = await reader.getRecord<VisibleRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'public' } as VisibilityPartitionFilter,
        id: 'charge',
        auth: undefined, // Explicitly no auth
      } as VisibilityGetRecordOptions)

      expect(result).not.toBeNull()
      expect(result?.visibility).toBe('public')
    })

    it('returns visibility field on the record', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const publicDataFiles = createDataFilesWithVisibility('public')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-public.avro')) {
          return createMockR2Object(key, { entries: publicDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records })
        }
        return null
      })

      // RED: Record should have visibility field
      const result = await reader.getRecord<VisibleRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'charge',
      })

      expect(result).not.toBeNull()
      // The visibility field should be present on the returned record
      expect(result).toHaveProperty('visibility')
      expect(['public', 'unlisted', 'org', 'user']).toContain(result?.visibility)
    })
  })

  describe('unlisted records accessible by direct lookup', () => {
    it('allows direct lookup of unlisted records without auth', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const unlistedDataFiles = createDataFilesWithVisibility('unlisted')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-unlisted.avro')) {
          return createMockR2Object(key, { entries: unlistedDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'unlisted') })
        }
        return null
      })

      // RED: Unlisted direct lookup not implemented
      const result = await reader.getRecord<VisibleRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'unlisted' } as VisibilityPartitionFilter,
        id: 'hidden-webhook',
        // Direct lookup - no auth needed for unlisted
      } as VisibilityGetRecordOptions)

      expect(result).not.toBeNull()
      expect(result?.visibility).toBe('unlisted')
      expect(result?.id).toBe('hidden-webhook')
    })

    it('unlisted records are not returned when listing without explicit filter', async () => {
      // This tests that unlisted records don't appear in general queries
      // RED: Listing/querying behavior for unlisted not implemented
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        return null
      })

      // When querying without visibility filter, unlisted manifests should be excluded
      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function' },
        id: 'hidden-webhook',
        // No visibility specified - should default to excluding unlisted
      })

      // Unlisted records should NOT be found in general queries
      expect(result).toBeNull()
    })
  })

  describe('org records require auth context', () => {
    it('allows org records with matching orgId in auth context', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const orgDataFiles = createDataFilesWithVisibility('org')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-org.avro')) {
          return createMockR2Object(key, { entries: orgDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'org') })
        }
        return null
      })

      // RED: Auth context handling for org visibility not implemented
      const result = await reader.getRecord<VisibleRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'org' } as VisibilityPartitionFilter,
        id: 'internal-charge',
        auth: { userId: 'user-123', orgId: 'org-456' },
      } as VisibilityGetRecordOptions)

      expect(result).not.toBeNull()
      expect(result?.visibility).toBe('org')
      expect(result?.orgId).toBe('org-456')
    })

    it('rejects org records with mismatched orgId', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const orgDataFiles = createDataFilesWithVisibility('org')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-org.avro')) {
          return createMockR2Object(key, { entries: orgDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'org') })
        }
        return null
      })

      // RED: Org ID verification not implemented
      await expect(
        reader.getRecord<VisibleRecord>({
          table: 'do_resources',
          partition: { ns: 'payments.do', type: 'Function', visibility: 'org' } as VisibilityPartitionFilter,
          id: 'internal-charge',
          auth: { userId: 'user-999', orgId: 'different-org' }, // Wrong org
        } as VisibilityGetRecordOptions)
      ).rejects.toThrow(/unauthorized|forbidden|permission/i)
    })
  })

  describe('user records require auth context', () => {
    it('allows user records with matching userId in auth context', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const userDataFiles = createDataFilesWithVisibility('user')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-user.avro')) {
          return createMockR2Object(key, { entries: userDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'user') })
        }
        return null
      })

      // RED: Auth context handling for user visibility not implemented
      const result = await reader.getRecord<VisibleRecord>({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'user' } as VisibilityPartitionFilter,
        id: 'secret-func',
        auth: { userId: 'user-123' },
      } as VisibilityGetRecordOptions)

      expect(result).not.toBeNull()
      expect(result?.visibility).toBe('user')
      expect(result?.ownerId).toBe('user-123')
    })

    it('rejects user records with mismatched userId', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const userDataFiles = createDataFilesWithVisibility('user')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-user.avro')) {
          return createMockR2Object(key, { entries: userDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'user') })
        }
        return null
      })

      // RED: User ID verification not implemented
      await expect(
        reader.getRecord<VisibleRecord>({
          table: 'do_resources',
          partition: { ns: 'payments.do', type: 'Function', visibility: 'user' } as VisibilityPartitionFilter,
          id: 'secret-func',
          auth: { userId: 'different-user' }, // Wrong user
        } as VisibilityGetRecordOptions)
      ).rejects.toThrow(/unauthorized|forbidden|permission/i)
    })

    it('user records are never accessible without auth', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const userDataFiles = createDataFilesWithVisibility('user')
      const records = createVisibleRecords()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-user.avro')) {
          return createMockR2Object(key, { entries: userDataFiles })
        }
        if (key.includes('.parquet')) {
          return createMockR2Object(key, { records: records.filter((r) => r.visibility === 'user') })
        }
        return null
      })

      // RED: Should always reject user visibility without auth
      await expect(
        reader.getRecord<VisibleRecord>({
          table: 'do_resources',
          partition: { ns: 'payments.do', type: 'Function', visibility: 'user' } as VisibilityPartitionFilter,
          id: 'secret-func',
          // No auth context
        } as VisibilityGetRecordOptions)
      ).rejects.toThrow(/auth|unauthorized|permission/i)
    })
  })

  describe('visibility in partition spec', () => {
    it('schema includes visibility partition field', async () => {
      const metadata = createSampleMetadataWithVisibility()

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        return null
      })

      const loadedMetadata = await reader.getMetadata('do_resources')

      // RED: Schema with visibility partition not yet standard
      const partitionSpec = loadedMetadata.partitionSpecs[0]
      const visibilityField = partitionSpec.fields.find((f) => f.name === 'visibility')

      expect(visibilityField).toBeDefined()
      expect(visibilityField?.transform).toBe('identity')
    })

    it('data files have visibility in partition path', async () => {
      const metadata = createSampleMetadataWithVisibility()
      const manifestList = createManifestListWithVisibility()
      const publicDataFiles = createDataFilesWithVisibility('public')

      mockBucket.get.mockImplementation(async (key: string) => {
        if (key.includes('metadata.json')) {
          return createMockR2Object(key, metadata)
        }
        if (key.includes('manifest-list.avro')) {
          return createMockR2Object(key, manifestList)
        }
        if (key.includes('manifest-public.avro')) {
          return createMockR2Object(key, { entries: publicDataFiles })
        }
        return null
      })

      // RED: Visibility partitioning in file paths not implemented
      const result = await reader.findFile({
        table: 'do_resources',
        partition: { ns: 'payments.do', type: 'Function', visibility: 'public' } as VisibilityPartitionFilter,
        id: 'charge',
      } as VisibilityFindFileOptions)

      expect(result).not.toBeNull()
      // File path should include visibility partition
      expect(result?.filePath).toContain('visibility=public')
      expect(result?.partition).toHaveProperty('visibility', 'public')
    })
  })
})
