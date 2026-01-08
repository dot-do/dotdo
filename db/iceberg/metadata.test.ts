/**
 * Iceberg Metadata Parser Tests
 *
 * RED phase TDD tests for parsing Iceberg metadata.json files.
 * These tests verify the parsing of table metadata for direct
 * Iceberg navigation (50-150ms vs 500ms-2s R2 SQL).
 *
 * Tests should FAIL until metadata.ts is implemented.
 *
 * @see https://iceberg.apache.org/spec/#table-metadata
 * @see db/iceberg/README.md
 */

import { describe, it, expect } from 'vitest'
import {
  parseMetadata,
  getCurrentSnapshot,
  getSchemaById,
  getFieldNames,
  getPartitionFieldNames,
  validateMetadata,
  type IcebergMetadata,
  type IcebergSchema,
  type PartitionSpec,
  type Snapshot,
  type ParsedMetadata,
} from './metadata'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Minimal valid Iceberg v2 metadata
 */
const MINIMAL_METADATA_V2 = {
  'format-version': 2,
  'table-uuid': 'fb072c92-a02b-11e9-ae9c-1bb1f3c2e5b4',
  location: 's3://bucket/warehouse/do_resources',
  'last-sequence-number': 1,
  'last-updated-ms': 1640995200000,
  'last-column-id': 5,
  'current-schema-id': 0,
  schemas: [
    {
      'schema-id': 0,
      type: 'struct',
      fields: [
        { id: 1, name: 'ns', required: true, type: 'string' },
        { id: 2, name: 'type', required: true, type: 'string' },
        { id: 3, name: 'id', required: true, type: 'string' },
        { id: 4, name: 'ts', required: false, type: 'timestamptz' },
        { id: 5, name: 'data', required: false, type: 'string' },
      ],
    },
  ],
  'default-spec-id': 0,
  'partition-specs': [
    {
      'spec-id': 0,
      fields: [
        { 'source-id': 1, 'field-id': 1000, name: 'ns', transform: 'identity' },
        { 'source-id': 2, 'field-id': 1001, name: 'type', transform: 'identity' },
      ],
    },
  ],
  'last-partition-id': 1001,
  'default-sort-order-id': 0,
  'sort-orders': [{ 'order-id': 0, fields: [] }],
  'current-snapshot-id': 3051729675574597004,
  snapshots: [
    {
      'snapshot-id': 3051729675574597004,
      'sequence-number': 1,
      'timestamp-ms': 1640995200000,
      'manifest-list': 's3://bucket/warehouse/do_resources/metadata/snap-3051729675574597004.avro',
      summary: {
        operation: 'append',
        'added-files-size': '1024',
        'added-records': '10',
      },
      'schema-id': 0,
    },
  ],
  'snapshot-log': [{ 'timestamp-ms': 1640995200000, 'snapshot-id': 3051729675574597004 }],
  refs: {
    main: {
      'snapshot-id': 3051729675574597004,
      type: 'branch',
    },
  },
  properties: {
    'write.format.default': 'parquet',
    'write.parquet.compression-codec': 'snappy',
  },
}

/**
 * Complete do_resources table metadata matching the README schema
 */
const DO_RESOURCES_METADATA = {
  'format-version': 2,
  'table-uuid': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  location: 's3://do-data-catalog/warehouse/do_resources',
  'last-sequence-number': 42,
  'last-updated-ms': 1704067200000,
  'last-column-id': 14,
  'current-schema-id': 1,
  schemas: [
    {
      'schema-id': 0,
      type: 'struct',
      fields: [
        { id: 1, name: 'ns', required: true, type: 'string' },
        { id: 2, name: 'type', required: true, type: 'string' },
        { id: 3, name: 'id', required: true, type: 'string' },
      ],
    },
    {
      'schema-id': 1,
      type: 'struct',
      fields: [
        { id: 1, name: 'ns', required: true, type: 'string', doc: 'Namespace (e.g., payments.do)' },
        { id: 2, name: 'type', required: true, type: 'string', doc: 'Resource type (Function, Agent, etc.)' },
        { id: 3, name: 'id', required: true, type: 'string', doc: 'Resource identifier' },
        { id: 4, name: 'ts', required: false, type: 'timestamptz', doc: 'Timestamp' },
        { id: 5, name: 'mdx', required: false, type: 'string', doc: 'MDX source' },
        {
          id: 6,
          name: 'data',
          required: false,
          type: {
            type: 'struct',
            fields: [
              { id: 100, name: 'version', required: false, type: 'string' },
              { id: 101, name: 'metadata', required: false, type: 'string' },
            ],
          },
          doc: 'Structured data',
        },
        { id: 7, name: 'esm', required: false, type: 'string', doc: 'Compiled ESM' },
        { id: 8, name: 'dts', required: false, type: 'string', doc: 'TypeScript declarations' },
        {
          id: 9,
          name: 'mdast',
          required: false,
          type: {
            type: 'struct',
            fields: [{ id: 200, name: 'root', required: true, type: 'string' }],
          },
        },
        {
          id: 10,
          name: 'hast',
          required: false,
          type: {
            type: 'struct',
            fields: [{ id: 201, name: 'root', required: true, type: 'string' }],
          },
        },
        {
          id: 11,
          name: 'estree',
          required: false,
          type: {
            type: 'struct',
            fields: [{ id: 202, name: 'root', required: true, type: 'string' }],
          },
        },
        {
          id: 12,
          name: 'tsast',
          required: false,
          type: {
            type: 'struct',
            fields: [{ id: 203, name: 'root', required: true, type: 'string' }],
          },
        },
        { id: 13, name: 'html', required: false, type: 'string', doc: 'Rendered HTML' },
        { id: 14, name: 'markdown', required: false, type: 'string', doc: 'Plain markdown' },
      ],
      'identifier-field-ids': [1, 2, 3],
    },
  ],
  'default-spec-id': 0,
  'partition-specs': [
    {
      'spec-id': 0,
      fields: [
        { 'source-id': 1, 'field-id': 1000, name: 'ns', transform: 'identity' },
        { 'source-id': 2, 'field-id': 1001, name: 'type', transform: 'identity' },
      ],
    },
  ],
  'last-partition-id': 1001,
  'default-sort-order-id': 1,
  'sort-orders': [
    { 'order-id': 0, fields: [] },
    {
      'order-id': 1,
      fields: [
        { 'source-id': 4, transform: 'identity', direction: 'desc', 'null-order': 'nulls-last' },
      ],
    },
  ],
  'current-snapshot-id': 5678901234567890123,
  snapshots: [
    {
      'snapshot-id': 1234567890123456789,
      'sequence-number': 1,
      'timestamp-ms': 1704000000000,
      'manifest-list': 's3://do-data-catalog/warehouse/do_resources/metadata/snap-1234567890123456789.avro',
      summary: { operation: 'append' },
      'schema-id': 0,
    },
    {
      'snapshot-id': 5678901234567890123,
      'parent-snapshot-id': 1234567890123456789,
      'sequence-number': 42,
      'timestamp-ms': 1704067200000,
      'manifest-list': 's3://do-data-catalog/warehouse/do_resources/metadata/snap-5678901234567890123.avro',
      summary: {
        operation: 'append',
        'added-files-size': '102400',
        'added-records': '1000',
        'total-records': '5000',
        'total-files-size': '512000',
      },
      'schema-id': 1,
    },
  ],
  'snapshot-log': [
    { 'timestamp-ms': 1704000000000, 'snapshot-id': 1234567890123456789 },
    { 'timestamp-ms': 1704067200000, 'snapshot-id': 5678901234567890123 },
  ],
  'metadata-log': [
    { 'timestamp-ms': 1704000000000, 'metadata-file': 's3://do-data-catalog/warehouse/do_resources/metadata/v1.metadata.json' },
  ],
  refs: {
    main: { 'snapshot-id': 5678901234567890123, type: 'branch' },
    'release-v1': { 'snapshot-id': 1234567890123456789, type: 'tag' },
  },
  properties: {
    'write.format.default': 'parquet',
    'write.parquet.compression-codec': 'zstd',
    'commit.manifest.min-count-to-merge': '10',
  },
}

/**
 * V1 format metadata (legacy)
 */
const V1_METADATA = {
  'format-version': 1,
  'table-uuid': 'legacy-table-uuid',
  location: 's3://bucket/warehouse/legacy_table',
  'last-updated-ms': 1609459200000,
  'last-column-id': 3,
  schema: {
    type: 'struct',
    fields: [
      { id: 1, name: 'id', required: true, type: 'long' },
      { id: 2, name: 'name', required: false, type: 'string' },
      { id: 3, name: 'value', required: false, type: 'double' },
    ],
  },
  'partition-spec': [
    { 'source-id': 1, 'field-id': 1000, name: 'id_bucket', transform: 'bucket[16]' },
  ],
  'current-snapshot-id': null,
  snapshots: [],
}

/**
 * Metadata with no snapshots (empty table)
 */
const EMPTY_TABLE_METADATA = {
  'format-version': 2,
  'table-uuid': 'empty-table-uuid',
  location: 's3://bucket/warehouse/empty_table',
  'last-sequence-number': 0,
  'last-updated-ms': 1704067200000,
  'last-column-id': 2,
  'current-schema-id': 0,
  schemas: [
    {
      'schema-id': 0,
      type: 'struct',
      fields: [
        { id: 1, name: 'id', required: true, type: 'string' },
        { id: 2, name: 'value', required: false, type: 'string' },
      ],
    },
  ],
  'default-spec-id': 0,
  'partition-specs': [{ 'spec-id': 0, fields: [] }],
  'last-partition-id': 999,
  'default-sort-order-id': 0,
  'sort-orders': [{ 'order-id': 0, fields: [] }],
  'current-snapshot-id': null,
  snapshots: [],
}

// ============================================================================
// parseMetadata() Tests
// ============================================================================

describe('parseMetadata', () => {
  describe('current-snapshot-id extraction', () => {
    it('returns current-snapshot-id from valid v2 metadata', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.currentSnapshotId).toBe(3051729675574597004)
      }
    })

    it('returns current-snapshot-id from do_resources metadata', () => {
      const result = parseMetadata(JSON.stringify(DO_RESOURCES_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.currentSnapshotId).toBe(5678901234567890123)
      }
    })

    it('returns null current-snapshot-id for empty table', () => {
      const result = parseMetadata(JSON.stringify(EMPTY_TABLE_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.currentSnapshotId).toBeNull()
      }
    })

    it('returns null current-snapshot-id for v1 metadata with no snapshots', () => {
      const result = parseMetadata(JSON.stringify(V1_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.currentSnapshotId).toBeNull()
      }
    })
  })

  describe('schema field extraction', () => {
    it('extracts current schema from v2 metadata', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.currentSchema).not.toBeNull()
        expect(result.data.currentSchema?.schemaId).toBe(0)
        expect(result.data.currentSchema?.fields).toHaveLength(5)
      }
    })

    it('extracts field names correctly', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        const fieldNames = result.data.currentSchema?.fields.map((f) => f.name)
        expect(fieldNames).toEqual(['ns', 'type', 'id', 'ts', 'data'])
      }
    })

    it('extracts field types correctly', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        const fields = result.data.currentSchema?.fields
        expect(fields?.find((f) => f.name === 'ns')?.type).toBe('string')
        expect(fields?.find((f) => f.name === 'ts')?.type).toBe('timestamptz')
      }
    })

    it('extracts required flags correctly', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        const fields = result.data.currentSchema?.fields
        expect(fields?.find((f) => f.name === 'ns')?.required).toBe(true)
        expect(fields?.find((f) => f.name === 'ts')?.required).toBe(false)
      }
    })

    it('handles nested struct types in do_resources schema', () => {
      const result = parseMetadata(JSON.stringify(DO_RESOURCES_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        const dataField = result.data.currentSchema?.fields.find((f) => f.name === 'data')
        expect(dataField).toBeDefined()
        expect(typeof dataField?.type).toBe('object')
        if (typeof dataField?.type === 'object' && dataField.type !== null) {
          expect((dataField.type as { type: string }).type).toBe('struct')
        }
      }
    })

    it('extracts all schemas from metadata', () => {
      const result = parseMetadata(JSON.stringify(DO_RESOURCES_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.schemas).toHaveLength(2)
        expect(result.data.schemas[0].schemaId).toBe(0)
        expect(result.data.schemas[1].schemaId).toBe(1)
      }
    })

    it('extracts identifier-field-ids when present', () => {
      const result = parseMetadata(JSON.stringify(DO_RESOURCES_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        const currentSchema = result.data.schemas.find((s) => s.schemaId === 1)
        expect(currentSchema?.identifierFieldIds).toEqual([1, 2, 3])
      }
    })

    it('extracts field documentation when present', () => {
      const result = parseMetadata(JSON.stringify(DO_RESOURCES_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        const nsField = result.data.currentSchema?.fields.find((f) => f.name === 'ns')
        expect(nsField?.doc).toBe('Namespace (e.g., payments.do)')
      }
    })
  })

  describe('partition spec extraction', () => {
    it('extracts partition spec from metadata', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.partitionSpec).not.toBeNull()
        expect(result.data.partitionSpec?.specId).toBe(0)
        expect(result.data.partitionSpec?.fields).toHaveLength(2)
      }
    })

    it('extracts partition field transforms', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        const partitionFields = result.data.partitionSpec?.fields
        expect(partitionFields?.[0].transform).toBe('identity')
        expect(partitionFields?.[1].transform).toBe('identity')
      }
    })

    it('handles unpartitioned tables', () => {
      const result = parseMetadata(JSON.stringify(EMPTY_TABLE_METADATA))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.partitionSpec?.fields).toHaveLength(0)
      }
    })
  })

  describe('location and properties', () => {
    it('extracts table location', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.location).toBe('s3://bucket/warehouse/do_resources')
      }
    })

    it('extracts format version', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.formatVersion).toBe(2)
      }
    })

    it('extracts table properties', () => {
      const result = parseMetadata(JSON.stringify(MINIMAL_METADATA_V2))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.properties['write.format.default']).toBe('parquet')
        expect(result.data.properties['write.parquet.compression-codec']).toBe('snappy')
      }
    })

    it('returns empty properties when not present', () => {
      const metadataNoProps = { ...EMPTY_TABLE_METADATA }
      delete (metadataNoProps as Record<string, unknown>).properties
      const result = parseMetadata(JSON.stringify(metadataNoProps))

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.properties).toEqual({})
      }
    })
  })

  describe('error handling', () => {
    it('returns error for invalid JSON', () => {
      const result = parseMetadata('not valid json {')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('INVALID_JSON')
        expect(result.error).toContain('JSON')
      }
    })

    it('returns error for missing format-version', () => {
      const invalid = { ...MINIMAL_METADATA_V2 }
      delete (invalid as Record<string, unknown>)['format-version']
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_REQUIRED')
        expect(result.error).toContain('format-version')
      }
    })

    it('returns error for missing location', () => {
      const invalid = { ...MINIMAL_METADATA_V2 }
      delete (invalid as Record<string, unknown>).location
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_REQUIRED')
        expect(result.error).toContain('location')
      }
    })

    it('returns error for missing schemas in v2', () => {
      const invalid = { ...MINIMAL_METADATA_V2 }
      delete (invalid as Record<string, unknown>).schemas
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_REQUIRED')
        expect(result.error).toContain('schemas')
      }
    })

    it('returns error for unsupported format version', () => {
      const invalid = { ...MINIMAL_METADATA_V2, 'format-version': 99 }
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('UNSUPPORTED_VERSION')
        expect(result.error).toContain('99')
      }
    })

    it('returns error for empty string input', () => {
      const result = parseMetadata('')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('INVALID_JSON')
      }
    })

    it('returns error for null schema fields', () => {
      const invalid = {
        ...MINIMAL_METADATA_V2,
        schemas: [{ 'schema-id': 0, type: 'struct', fields: null }],
      }
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('INVALID_FORMAT')
      }
    })

    it('returns error when current-schema-id references non-existent schema', () => {
      const invalid = { ...MINIMAL_METADATA_V2, 'current-schema-id': 999 }
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('INVALID_FORMAT')
        expect(result.error).toContain('schema')
      }
    })

    it('returns error when current-snapshot-id references non-existent snapshot', () => {
      const invalid = { ...MINIMAL_METADATA_V2, 'current-snapshot-id': 999999 }
      const result = parseMetadata(JSON.stringify(invalid))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('INVALID_FORMAT')
        expect(result.error).toContain('snapshot')
      }
    })
  })
})

// ============================================================================
// getCurrentSnapshot() Tests
// ============================================================================

describe('getCurrentSnapshot', () => {
  it('returns current snapshot when it exists', () => {
    // Create a mock parsed metadata object
    const metadata: IcebergMetadata = {
      formatVersion: 2,
      tableUuid: 'test-uuid',
      location: 's3://test',
      lastSequenceNumber: 1,
      lastUpdatedMs: Date.now(),
      lastColumnId: 1,
      currentSchemaId: 0,
      schemas: [],
      defaultSpecId: 0,
      partitionSpecs: [],
      lastPartitionId: 0,
      defaultSortOrderId: 0,
      sortOrders: [],
      currentSnapshotId: 123,
      snapshots: [
        {
          snapshotId: 123,
          sequenceNumber: 1,
          timestampMs: Date.now(),
          manifestList: 's3://test/manifest.avro',
          summary: { operation: 'append' },
        },
      ],
    }

    const snapshot = getCurrentSnapshot(metadata)

    expect(snapshot).not.toBeNull()
    expect(snapshot?.snapshotId).toBe(123)
    expect(snapshot?.manifestList).toBe('s3://test/manifest.avro')
  })

  it('returns null when currentSnapshotId is null', () => {
    const metadata: IcebergMetadata = {
      formatVersion: 2,
      tableUuid: 'test-uuid',
      location: 's3://test',
      lastSequenceNumber: 0,
      lastUpdatedMs: Date.now(),
      lastColumnId: 1,
      currentSchemaId: 0,
      schemas: [],
      defaultSpecId: 0,
      partitionSpecs: [],
      lastPartitionId: 0,
      defaultSortOrderId: 0,
      sortOrders: [],
      currentSnapshotId: null,
      snapshots: [],
    }

    const snapshot = getCurrentSnapshot(metadata)

    expect(snapshot).toBeNull()
  })

  it('returns null when snapshot not found in snapshots array', () => {
    const metadata: IcebergMetadata = {
      formatVersion: 2,
      tableUuid: 'test-uuid',
      location: 's3://test',
      lastSequenceNumber: 1,
      lastUpdatedMs: Date.now(),
      lastColumnId: 1,
      currentSchemaId: 0,
      schemas: [],
      defaultSpecId: 0,
      partitionSpecs: [],
      lastPartitionId: 0,
      defaultSortOrderId: 0,
      sortOrders: [],
      currentSnapshotId: 999,
      snapshots: [
        {
          snapshotId: 123,
          sequenceNumber: 1,
          timestampMs: Date.now(),
          manifestList: 's3://test/manifest.avro',
          summary: { operation: 'append' },
        },
      ],
    }

    const snapshot = getCurrentSnapshot(metadata)

    expect(snapshot).toBeNull()
  })
})

// ============================================================================
// getSchemaById() Tests
// ============================================================================

describe('getSchemaById', () => {
  const metadata: IcebergMetadata = {
    formatVersion: 2,
    tableUuid: 'test-uuid',
    location: 's3://test',
    lastSequenceNumber: 1,
    lastUpdatedMs: Date.now(),
    lastColumnId: 3,
    currentSchemaId: 1,
    schemas: [
      {
        schemaId: 0,
        type: 'struct',
        fields: [{ id: 1, name: 'old_field', required: true, type: 'string' }],
      },
      {
        schemaId: 1,
        type: 'struct',
        fields: [
          { id: 1, name: 'id', required: true, type: 'string' },
          { id: 2, name: 'name', required: false, type: 'string' },
        ],
      },
    ],
    defaultSpecId: 0,
    partitionSpecs: [],
    lastPartitionId: 0,
    defaultSortOrderId: 0,
    sortOrders: [],
    currentSnapshotId: null,
    snapshots: [],
  }

  it('returns schema when found by id', () => {
    const schema = getSchemaById(metadata, 1)

    expect(schema).not.toBeNull()
    expect(schema?.schemaId).toBe(1)
    expect(schema?.fields).toHaveLength(2)
  })

  it('returns null when schema not found', () => {
    const schema = getSchemaById(metadata, 999)

    expect(schema).toBeNull()
  })

  it('returns correct schema for id 0', () => {
    const schema = getSchemaById(metadata, 0)

    expect(schema).not.toBeNull()
    expect(schema?.schemaId).toBe(0)
    expect(schema?.fields).toHaveLength(1)
    expect(schema?.fields[0].name).toBe('old_field')
  })
})

// ============================================================================
// getFieldNames() Tests
// ============================================================================

describe('getFieldNames', () => {
  it('returns field names from schema', () => {
    const schema: IcebergSchema = {
      schemaId: 0,
      type: 'struct',
      fields: [
        { id: 1, name: 'ns', required: true, type: 'string' },
        { id: 2, name: 'type', required: true, type: 'string' },
        { id: 3, name: 'id', required: true, type: 'string' },
      ],
    }

    const names = getFieldNames(schema)

    expect(names).toEqual(['ns', 'type', 'id'])
  })

  it('returns empty array for schema with no fields', () => {
    const schema: IcebergSchema = {
      schemaId: 0,
      type: 'struct',
      fields: [],
    }

    const names = getFieldNames(schema)

    expect(names).toEqual([])
  })

  it('handles schema with many fields', () => {
    const schema: IcebergSchema = {
      schemaId: 1,
      type: 'struct',
      fields: [
        { id: 1, name: 'ns', required: true, type: 'string' },
        { id: 2, name: 'type', required: true, type: 'string' },
        { id: 3, name: 'id', required: true, type: 'string' },
        { id: 4, name: 'ts', required: false, type: 'timestamptz' },
        { id: 5, name: 'mdx', required: false, type: 'string' },
        { id: 6, name: 'data', required: false, type: 'string' },
        { id: 7, name: 'esm', required: false, type: 'string' },
        { id: 8, name: 'dts', required: false, type: 'string' },
        { id: 9, name: 'html', required: false, type: 'string' },
        { id: 10, name: 'markdown', required: false, type: 'string' },
      ],
    }

    const names = getFieldNames(schema)

    expect(names).toHaveLength(10)
    expect(names).toContain('ns')
    expect(names).toContain('markdown')
  })
})

// ============================================================================
// getPartitionFieldNames() Tests
// ============================================================================

describe('getPartitionFieldNames', () => {
  const schema: IcebergSchema = {
    schemaId: 0,
    type: 'struct',
    fields: [
      { id: 1, name: 'ns', required: true, type: 'string' },
      { id: 2, name: 'type', required: true, type: 'string' },
      { id: 3, name: 'id', required: true, type: 'string' },
      { id: 4, name: 'ts', required: false, type: 'timestamptz' },
    ],
  }

  it('returns partition field names for identity transform', () => {
    const spec: PartitionSpec = {
      specId: 0,
      fields: [
        { sourceId: 1, fieldId: 1000, name: 'ns', transform: 'identity' },
        { sourceId: 2, fieldId: 1001, name: 'type', transform: 'identity' },
      ],
    }

    const names = getPartitionFieldNames(spec, schema)

    expect(names).toEqual(['ns', 'type'])
  })

  it('returns empty array for unpartitioned spec', () => {
    const spec: PartitionSpec = {
      specId: 0,
      fields: [],
    }

    const names = getPartitionFieldNames(spec, schema)

    expect(names).toEqual([])
  })

  it('handles bucket transform partition fields', () => {
    const spec: PartitionSpec = {
      specId: 0,
      fields: [{ sourceId: 3, fieldId: 1000, name: 'id_bucket', transform: 'bucket[16]' }],
    }

    const names = getPartitionFieldNames(spec, schema)

    // Should return the source field name, not the partition field name
    expect(names).toEqual(['id'])
  })
})

// ============================================================================
// validateMetadata() Tests
// ============================================================================

describe('validateMetadata', () => {
  it('returns true for valid v2 metadata', () => {
    const isValid = validateMetadata(MINIMAL_METADATA_V2)

    expect(isValid).toBe(true)
  })

  it('returns true for valid do_resources metadata', () => {
    const isValid = validateMetadata(DO_RESOURCES_METADATA)

    expect(isValid).toBe(true)
  })

  it('returns false for null', () => {
    const isValid = validateMetadata(null)

    expect(isValid).toBe(false)
  })

  it('returns false for undefined', () => {
    const isValid = validateMetadata(undefined)

    expect(isValid).toBe(false)
  })

  it('returns false for non-object', () => {
    const isValid = validateMetadata('string')

    expect(isValid).toBe(false)
  })

  it('returns false for array', () => {
    const isValid = validateMetadata([1, 2, 3])

    expect(isValid).toBe(false)
  })

  it('returns false for missing format-version', () => {
    const invalid = { ...MINIMAL_METADATA_V2 }
    delete (invalid as Record<string, unknown>)['format-version']

    const isValid = validateMetadata(invalid)

    expect(isValid).toBe(false)
  })

  it('returns false for invalid format-version type', () => {
    const invalid = { ...MINIMAL_METADATA_V2, 'format-version': 'two' }

    const isValid = validateMetadata(invalid)

    expect(isValid).toBe(false)
  })

  it('returns false for missing location', () => {
    const invalid = { ...MINIMAL_METADATA_V2 }
    delete (invalid as Record<string, unknown>).location

    const isValid = validateMetadata(invalid)

    expect(isValid).toBe(false)
  })

  it('returns false for invalid schemas type', () => {
    const invalid = { ...MINIMAL_METADATA_V2, schemas: 'not-an-array' }

    const isValid = validateMetadata(invalid)

    expect(isValid).toBe(false)
  })
})
