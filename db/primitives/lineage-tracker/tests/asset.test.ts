/**
 * Asset and Edge Data Model Tests
 *
 * Test suite for URN-based asset identification and edge modeling.
 * Covers:
 * - URN parsing and validation
 * - Asset creation with validation
 * - Edge creation with valid/invalid asset refs
 * - Transformation types and confidence scores
 */
import { describe, it, expect } from 'vitest'
import {
  // URN utilities
  parseURN,
  buildURN,
  validateURN,
  areRelatedURNs,
  getParentURN,
  inferAssetType,
  extractNameFromURN,
  // Asset functions
  createAsset,
  // Edge functions
  createEdgeV2,
  validateConfidence,
  isValidTransformationType,
  // Types
  type ParsedURN,
  type URNScheme,
  type AssetType,
  type TransformationType,
  type LineageSource,
} from '../asset'

// =============================================================================
// URN PARSING TESTS
// =============================================================================

describe('URN Parsing', () => {
  describe('parseURN', () => {
    it('should parse a simple database URN', () => {
      const result = parseURN('db://postgres/public/users/email')

      expect(result).not.toBeNull()
      expect(result!.scheme).toBe('db')
      expect(result!.authority).toBe('postgres')
      expect(result!.path).toEqual(['public', 'users', 'email'])
      expect(result!.raw).toBe('db://postgres/public/users/email')
    })

    it('should parse URN with only authority (no path)', () => {
      const result = parseURN('db://postgres')

      expect(result).not.toBeNull()
      expect(result!.scheme).toBe('db')
      expect(result!.authority).toBe('postgres')
      expect(result!.path).toEqual([])
    })

    it('should parse URN with single path segment', () => {
      const result = parseURN('db://postgres/public')

      expect(result).not.toBeNull()
      expect(result!.path).toEqual(['public'])
    })

    it('should parse S3 URN', () => {
      const result = parseURN('s3://my-bucket/path/to/file.parquet')

      expect(result).not.toBeNull()
      expect(result!.scheme).toBe('s3')
      expect(result!.authority).toBe('my-bucket')
      expect(result!.path).toEqual(['path', 'to', 'file.parquet'])
    })

    it('should parse API URN', () => {
      const result = parseURN('api://payments-service/v1/transactions')

      expect(result).not.toBeNull()
      expect(result!.scheme).toBe('api')
      expect(result!.authority).toBe('payments-service')
      expect(result!.path).toEqual(['v1', 'transactions'])
    })

    it('should parse pipeline URN', () => {
      const result = parseURN('pipeline://etl/daily-aggregation/task-1')

      expect(result).not.toBeNull()
      expect(result!.scheme).toBe('pipeline')
      expect(result!.authority).toBe('etl')
      expect(result!.path).toEqual(['daily-aggregation', 'task-1'])
    })

    it('should parse Kafka URN', () => {
      const result = parseURN('kafka://production-cluster/user-events')

      expect(result).not.toBeNull()
      expect(result!.scheme).toBe('kafka')
      expect(result!.authority).toBe('production-cluster')
      expect(result!.path).toEqual(['user-events'])
    })

    it('should normalize scheme to lowercase', () => {
      const result = parseURN('DB://postgres/public')

      expect(result!.scheme).toBe('db')
    })

    it('should return null for invalid URN without scheme', () => {
      const result = parseURN('postgres/public/users')

      expect(result).toBeNull()
    })

    it('should return null for invalid URN without authority', () => {
      const result = parseURN('db:///public/users')

      expect(result).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseURN('')).toBeNull()
    })

    it('should return null for malformed URN', () => {
      expect(parseURN('not-a-urn')).toBeNull()
      expect(parseURN('://missing-scheme')).toBeNull()
      expect(parseURN('db:single-slash/path')).toBeNull()
    })

    it('should handle URN with special characters in path', () => {
      const result = parseURN('db://postgres/my-schema/user_data')

      expect(result).not.toBeNull()
      expect(result!.path).toEqual(['my-schema', 'user_data'])
    })

    it('should handle URN with dots in path', () => {
      const result = parseURN('file://storage/data.2024/file.csv')

      expect(result).not.toBeNull()
      expect(result!.path).toEqual(['data.2024', 'file.csv'])
    })
  })

  describe('buildURN', () => {
    it('should build URN from components', () => {
      const urn = buildURN('db', 'postgres', ['public', 'users', 'email'])

      expect(urn).toBe('db://postgres/public/users/email')
    })

    it('should build URN with empty path', () => {
      const urn = buildURN('db', 'postgres', [])

      expect(urn).toBe('db://postgres')
    })

    it('should build URN with single path segment', () => {
      const urn = buildURN('s3', 'bucket', ['folder'])

      expect(urn).toBe('s3://bucket/folder')
    })

    it('should roundtrip through parse and build', () => {
      const original = 'db://warehouse/analytics/events/user_id'
      const parsed = parseURN(original)!
      const rebuilt = buildURN(parsed.scheme, parsed.authority, parsed.path)

      expect(rebuilt).toBe(original)
    })
  })
})

// =============================================================================
// URN VALIDATION TESTS
// =============================================================================

describe('URN Validation', () => {
  describe('validateURN', () => {
    it('should validate correct database URN', () => {
      const result = validateURN('db://postgres/public/users')

      expect(result.valid).toBe(true)
      expect(result.parsed).not.toBeNull()
      expect(result.error).toBeUndefined()
    })

    it('should validate all supported schemes', () => {
      const schemes: URNScheme[] = ['db', 'file', 'api', 'pipeline', 'warehouse', 's3', 'gcs', 'kafka', 'custom']

      for (const scheme of schemes) {
        const result = validateURN(`${scheme}://authority/path`)
        expect(result.valid).toBe(true)
      }
    })

    it('should reject unsupported scheme', () => {
      const result = validateURN('ftp://server/path')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid scheme')
      expect(result.error).toContain('ftp')
    })

    it('should reject empty string', () => {
      const result = validateURN('')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('non-empty string')
    })

    it('should reject null/undefined', () => {
      expect(validateURN(null as unknown as string).valid).toBe(false)
      expect(validateURN(undefined as unknown as string).valid).toBe(false)
    })

    it('should reject URN exceeding max length', () => {
      const longPath = '/segment'.repeat(300) // > 2048 chars
      const result = validateURN(`db://postgres${longPath}`)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('maximum length')
    })

    it('should reject malformed URN', () => {
      const result = validateURN('not-a-valid-urn')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid URN format')
    })

    it('should reject URN with empty authority', () => {
      // This would fail the regex, but we'll check the error handling
      const result = validateURN('db:///path')

      expect(result.valid).toBe(false)
    })

    it('should include parsed URN on success', () => {
      const result = validateURN('db://warehouse/analytics/events')

      expect(result.valid).toBe(true)
      expect(result.parsed!.scheme).toBe('db')
      expect(result.parsed!.authority).toBe('warehouse')
      expect(result.parsed!.path).toEqual(['analytics', 'events'])
    })
  })
})

// =============================================================================
// URN RELATIONSHIP TESTS
// =============================================================================

describe('URN Relationships', () => {
  describe('areRelatedURNs', () => {
    it('should detect parent-child relationship', () => {
      const parent = 'db://postgres/public/users'
      const child = 'db://postgres/public/users/email'

      expect(areRelatedURNs(parent, child)).toBe(true)
      expect(areRelatedURNs(child, parent)).toBe(true)
    })

    it('should detect grandparent relationship', () => {
      const grandparent = 'db://postgres/public'
      const grandchild = 'db://postgres/public/users/email'

      expect(areRelatedURNs(grandparent, grandchild)).toBe(true)
    })

    it('should return false for different schemes', () => {
      const urn1 = 'db://postgres/public/users'
      const urn2 = 'file://postgres/public/users'

      expect(areRelatedURNs(urn1, urn2)).toBe(false)
    })

    it('should return false for different authorities', () => {
      const urn1 = 'db://postgres/public/users'
      const urn2 = 'db://mysql/public/users'

      expect(areRelatedURNs(urn1, urn2)).toBe(false)
    })

    it('should return false for sibling URNs', () => {
      const urn1 = 'db://postgres/public/users'
      const urn2 = 'db://postgres/public/orders'

      expect(areRelatedURNs(urn1, urn2)).toBe(false)
    })

    it('should return false for invalid URNs', () => {
      expect(areRelatedURNs('invalid', 'db://postgres/table')).toBe(false)
      expect(areRelatedURNs('db://postgres/table', 'invalid')).toBe(false)
    })

    it('should detect identical URNs as related', () => {
      const urn = 'db://postgres/public/users'

      expect(areRelatedURNs(urn, urn)).toBe(true)
    })
  })

  describe('getParentURN', () => {
    it('should return parent URN for column', () => {
      const columnUrn = 'db://postgres/public/users/email'
      const parent = getParentURN(columnUrn)

      expect(parent).toBe('db://postgres/public/users')
    })

    it('should return parent URN for table', () => {
      const tableUrn = 'db://postgres/public/users'
      const parent = getParentURN(tableUrn)

      expect(parent).toBe('db://postgres/public')
    })

    it('should return null for URN without path', () => {
      const dbUrn = 'db://postgres'
      const parent = getParentURN(dbUrn)

      expect(parent).toBeNull()
    })

    it('should return null for invalid URN', () => {
      expect(getParentURN('invalid-urn')).toBeNull()
    })

    it('should handle deep paths', () => {
      const deepUrn = 'file://storage/a/b/c/d/e.txt'
      const parent = getParentURN(deepUrn)

      expect(parent).toBe('file://storage/a/b/c/d')
    })
  })
})

// =============================================================================
// ASSET TYPE INFERENCE TESTS
// =============================================================================

describe('Asset Type Inference', () => {
  describe('inferAssetType', () => {
    it('should infer database type for db:// without path', () => {
      expect(inferAssetType('db://postgres')).toBe('database')
    })

    it('should infer schema type for single path segment', () => {
      expect(inferAssetType('db://postgres/public')).toBe('schema')
    })

    it('should infer table type for two path segments', () => {
      expect(inferAssetType('db://postgres/public/users')).toBe('table')
    })

    it('should infer column type for three path segments', () => {
      expect(inferAssetType('db://postgres/public/users/email')).toBe('column')
    })

    it('should infer column type for deep paths', () => {
      expect(inferAssetType('db://postgres/public/users/address/city')).toBe('column')
    })

    it('should infer file type for file:// scheme', () => {
      expect(inferAssetType('file://storage/data/file.parquet')).toBe('file')
    })

    it('should infer directory type for file:// ending with slash', () => {
      expect(inferAssetType('file://storage/data/')).toBe('directory')
    })

    it('should infer file type for s3://', () => {
      expect(inferAssetType('s3://bucket/path/file.csv')).toBe('file')
    })

    it('should infer api type for api:// without path', () => {
      expect(inferAssetType('api://service')).toBe('api')
    })

    it('should infer endpoint type for api:// with path', () => {
      expect(inferAssetType('api://service/v1/users')).toBe('endpoint')
    })

    it('should infer pipeline type for pipeline:// without path', () => {
      expect(inferAssetType('pipeline://etl')).toBe('pipeline')
    })

    it('should infer job type for pipeline:// with path', () => {
      expect(inferAssetType('pipeline://etl/daily-job')).toBe('job')
    })

    it('should infer dataset type for kafka://', () => {
      expect(inferAssetType('kafka://cluster/topic')).toBe('dataset')
    })

    it('should return null for invalid URN', () => {
      expect(inferAssetType('invalid')).toBeNull()
    })
  })

  describe('extractNameFromURN', () => {
    it('should extract last path segment as name', () => {
      expect(extractNameFromURN('db://postgres/public/users/email')).toBe('email')
    })

    it('should extract authority when no path', () => {
      expect(extractNameFromURN('db://postgres')).toBe('postgres')
    })

    it('should return original string for invalid URN', () => {
      expect(extractNameFromURN('invalid')).toBe('invalid')
    })

    it('should handle file names with extensions', () => {
      expect(extractNameFromURN('s3://bucket/data/file.parquet')).toBe('file.parquet')
    })
  })
})

// =============================================================================
// ASSET CREATION TESTS
// =============================================================================

describe('Asset Creation', () => {
  describe('createAsset', () => {
    it('should create asset with minimal input', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
      })

      expect(asset.urn).toBe('db://postgres/public/users')
      expect(asset.type).toBe('table')
      expect(asset.name).toBe('users') // extracted from URN
      expect(asset.parsedUrn.scheme).toBe('db')
      expect(asset.parsedUrn.authority).toBe('postgres')
      expect(asset.parsedUrn.path).toEqual(['public', 'users'])
      expect(asset.createdAt).toBeLessThanOrEqual(Date.now())
      expect(asset.updatedAt).toBeLessThanOrEqual(Date.now())
    })

    it('should use provided name over extracted name', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
        name: 'User Table',
      })

      expect(asset.name).toBe('User Table')
    })

    it('should include ownership information', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
        ownership: {
          owner: 'data-platform',
          steward: 'alice@company.com',
          team: 'Platform',
        },
      })

      expect(asset.ownership.owner).toBe('data-platform')
      expect(asset.ownership.steward).toBe('alice@company.com')
      expect(asset.ownership.team).toBe('Platform')
    })

    it('should include tags', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users/email',
        type: 'column',
        tags: {
          pii: 'high',
          sensitivity: 'confidential',
          custom: ['gdpr', 'encrypted'],
          domains: ['customer', 'identity'],
        },
      })

      expect(asset.tags.pii).toBe('high')
      expect(asset.tags.sensitivity).toBe('confidential')
      expect(asset.tags.custom).toEqual(['gdpr', 'encrypted'])
      expect(asset.tags.domains).toEqual(['customer', 'identity'])
    })

    it('should include schema information', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users/email',
        type: 'column',
        schema: {
          dataType: 'varchar(255)',
          nullable: false,
          primaryKey: false,
          constraints: ['unique', 'not null'],
        },
      })

      expect(asset.schema!.dataType).toBe('varchar(255)')
      expect(asset.schema!.nullable).toBe(false)
      expect(asset.schema!.constraints).toContain('unique')
    })

    it('should include quality metrics', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
        quality: {
          completeness: 0.98,
          accuracy: 0.95,
          freshness: Date.now() - 3600000, // 1 hour ago
        },
      })

      expect(asset.quality!.completeness).toBe(0.98)
      expect(asset.quality!.accuracy).toBe(0.95)
    })

    it('should include custom metadata', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
        metadata: {
          rowCount: 1000000,
          sizeBytes: 512000000,
          partitioned: true,
          partitionKey: 'created_at',
        },
      })

      expect(asset.metadata.rowCount).toBe(1000000)
      expect(asset.metadata.partitioned).toBe(true)
    })

    it('should throw error for invalid URN', () => {
      expect(() =>
        createAsset({
          urn: 'invalid-urn',
          type: 'table',
        })
      ).toThrow(/Invalid URN/)
    })

    it('should throw error for unsupported scheme', () => {
      expect(() =>
        createAsset({
          urn: 'ftp://server/file',
          type: 'file',
        })
      ).toThrow(/Invalid URN/)
    })

    it('should default empty objects for ownership and tags', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
      })

      expect(asset.ownership).toEqual({})
      expect(asset.tags).toEqual({})
      expect(asset.metadata).toEqual({})
    })

    it('should set external ID when provided', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
        externalId: 'hive-metastore-12345',
      })

      expect(asset.externalId).toBe('hive-metastore-12345')
    })

    it('should include description when provided', () => {
      const asset = createAsset({
        urn: 'db://postgres/public/users',
        type: 'table',
        description: 'Main users table containing customer data',
      })

      expect(asset.description).toBe('Main users table containing customer data')
    })
  })
})

// =============================================================================
// EDGE CREATION TESTS
// =============================================================================

describe('Edge Creation', () => {
  describe('createEdgeV2', () => {
    it('should create edge with minimal input', () => {
      const edge = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'direct',
      })

      expect(edge.id).toBeDefined()
      expect(edge.sourceUrn).toBe('db://postgres/public/users')
      expect(edge.targetUrn).toBe('db://warehouse/analytics/dim_users')
      expect(edge.transformationType).toBe('direct')
      expect(edge.lineageSource).toBe('declared') // default
      expect(edge.confidence).toBe(1.0) // default for declared
      expect(edge.active).toBe(true)
      expect(edge.createdAt).toBeLessThanOrEqual(Date.now())
      expect(edge.lastObservedAt).toBeLessThanOrEqual(Date.now())
    })

    it('should generate unique edge IDs', () => {
      const edge1 = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'direct',
      })

      const edge2 = createEdgeV2({
        sourceUrn: 'db://postgres/public/orders',
        targetUrn: 'db://warehouse/analytics/dim_orders',
        transformationType: 'direct',
      })

      expect(edge1.id).not.toBe(edge2.id)
    })

    it('should use correct default confidence for each lineage source', () => {
      const sources: Array<{ source: LineageSource; expectedConfidence: number }> = [
        { source: 'declared', expectedConfidence: 1.0 },
        { source: 'parsed', expectedConfidence: 0.9 },
        { source: 'imported', expectedConfidence: 0.85 },
        { source: 'inferred', expectedConfidence: 0.5 },
      ]

      for (const { source, expectedConfidence } of sources) {
        const edge = createEdgeV2({
          sourceUrn: 'db://postgres/public/users',
          targetUrn: 'db://warehouse/analytics/dim_users',
          transformationType: 'direct',
          lineageSource: source,
        })

        expect(edge.confidence).toBe(expectedConfidence)
      }
    })

    it('should use explicit confidence when provided', () => {
      const edge = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'derived',
        lineageSource: 'inferred',
        confidence: 0.75,
      })

      expect(edge.confidence).toBe(0.75)
    })

    it('should include transformation metadata', () => {
      const edge = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'derived',
        transformation: {
          sql: 'SELECT id, email, created_at FROM users WHERE active = true',
          columnMappings: [
            { source: 'id', target: 'user_id' },
            { source: 'email', target: 'email' },
            { source: 'created_at', target: 'signup_date' },
          ],
        },
      })

      expect(edge.transformation.sql).toContain('SELECT')
      expect(edge.transformation.columnMappings).toHaveLength(3)
      expect(edge.transformation.columnMappings![0].source).toBe('id')
      expect(edge.transformation.columnMappings![0].target).toBe('user_id')
    })

    it('should include job and run IDs', () => {
      const edge = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'direct',
        jobId: 'etl-pipeline-123',
        runId: 'run-456',
      })

      expect(edge.jobId).toBe('etl-pipeline-123')
      expect(edge.runId).toBe('run-456')
    })

    it('should include operation label', () => {
      const edge = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'direct',
        operation: 'nightly_sync',
      })

      expect(edge.operation).toBe('nightly_sync')
    })

    it('should include custom metadata', () => {
      const edge = createEdgeV2({
        sourceUrn: 'db://postgres/public/users',
        targetUrn: 'db://warehouse/analytics/dim_users',
        transformationType: 'direct',
        metadata: {
          executionDuration: 1500,
          rowsProcessed: 10000,
          bytesTransferred: 5000000,
        },
      })

      expect(edge.metadata.executionDuration).toBe(1500)
      expect(edge.metadata.rowsProcessed).toBe(10000)
    })

    it('should throw error for invalid source URN', () => {
      expect(() =>
        createEdgeV2({
          sourceUrn: 'invalid-source',
          targetUrn: 'db://warehouse/analytics/dim_users',
          transformationType: 'direct',
        })
      ).toThrow(/Invalid source URN/)
    })

    it('should throw error for invalid target URN', () => {
      expect(() =>
        createEdgeV2({
          sourceUrn: 'db://postgres/public/users',
          targetUrn: 'invalid-target',
          transformationType: 'direct',
        })
      ).toThrow(/Invalid target URN/)
    })

    it('should handle all transformation types', () => {
      const types: TransformationType[] = [
        'direct',
        'derived',
        'aggregated',
        'filtered',
        'joined',
        'enriched',
        'masked',
        'custom',
      ]

      for (const type of types) {
        const edge = createEdgeV2({
          sourceUrn: 'db://postgres/public/users',
          targetUrn: 'db://warehouse/analytics/dim_users',
          transformationType: type,
        })

        expect(edge.transformationType).toBe(type)
      }
    })
  })
})

// =============================================================================
// VALIDATION UTILITY TESTS
// =============================================================================

describe('Validation Utilities', () => {
  describe('validateConfidence', () => {
    it('should accept valid confidence scores', () => {
      expect(validateConfidence(0)).toBe(true)
      expect(validateConfidence(0.5)).toBe(true)
      expect(validateConfidence(1)).toBe(true)
      expect(validateConfidence(0.001)).toBe(true)
      expect(validateConfidence(0.999)).toBe(true)
    })

    it('should reject confidence below 0', () => {
      expect(validateConfidence(-0.1)).toBe(false)
      expect(validateConfidence(-1)).toBe(false)
    })

    it('should reject confidence above 1', () => {
      expect(validateConfidence(1.1)).toBe(false)
      expect(validateConfidence(2)).toBe(false)
    })

    it('should reject NaN', () => {
      expect(validateConfidence(NaN)).toBe(false)
    })

    it('should reject non-number values', () => {
      expect(validateConfidence('0.5' as unknown as number)).toBe(false)
      expect(validateConfidence(null as unknown as number)).toBe(false)
      expect(validateConfidence(undefined as unknown as number)).toBe(false)
    })
  })

  describe('isValidTransformationType', () => {
    it('should accept valid transformation types', () => {
      const validTypes = ['direct', 'derived', 'aggregated', 'filtered', 'joined', 'enriched', 'masked', 'custom']

      for (const type of validTypes) {
        expect(isValidTransformationType(type)).toBe(true)
      }
    })

    it('should reject invalid transformation types', () => {
      expect(isValidTransformationType('invalid')).toBe(false)
      expect(isValidTransformationType('copy')).toBe(false)
      expect(isValidTransformationType('')).toBe(false)
    })
  })
})

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('Edge Cases', () => {
  it('should handle URN with many path segments', () => {
    const urn = 'db://postgres/a/b/c/d/e/f/g/h/i/j'
    const parsed = parseURN(urn)

    expect(parsed).not.toBeNull()
    expect(parsed!.path).toHaveLength(10)
  })

  it('should handle URN with numeric path segments', () => {
    const urn = 's3://bucket/2024/01/13/data.parquet'
    const parsed = parseURN(urn)

    expect(parsed).not.toBeNull()
    expect(parsed!.path).toEqual(['2024', '01', '13', 'data.parquet'])
  })

  it('should handle URN with UUID in path', () => {
    const urn = 'pipeline://etl/runs/550e8400-e29b-41d4-a716-446655440000'
    const parsed = parseURN(urn)

    expect(parsed).not.toBeNull()
    expect(parsed!.path[1]).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('should handle GCS URN', () => {
    const urn = 'gcs://my-bucket/path/to/file.json'
    const validation = validateURN(urn)

    expect(validation.valid).toBe(true)
    expect(validation.parsed!.scheme).toBe('gcs')
  })

  it('should handle custom scheme URN', () => {
    const urn = 'custom://my-system/resource/123'
    const validation = validateURN(urn)

    expect(validation.valid).toBe(true)
    expect(validation.parsed!.scheme).toBe('custom')
  })

  it('should create asset from S3 URN', () => {
    const asset = createAsset({
      urn: 's3://data-lake/raw/events/2024/01/events.parquet',
      type: 'file',
      metadata: {
        format: 'parquet',
        compression: 'snappy',
      },
    })

    expect(asset.urn).toBe('s3://data-lake/raw/events/2024/01/events.parquet')
    expect(asset.type).toBe('file')
    expect(asset.name).toBe('events.parquet')
  })

  it('should create edge between different schemes', () => {
    const edge = createEdgeV2({
      sourceUrn: 's3://data-lake/raw/events.parquet',
      targetUrn: 'db://warehouse/staging/events',
      transformationType: 'direct',
      operation: 's3_to_warehouse_sync',
    })

    expect(edge.sourceUrn).toContain('s3://')
    expect(edge.targetUrn).toContain('db://')
  })

  it('should create aggregation edge with expression', () => {
    const edge = createEdgeV2({
      sourceUrn: 'db://postgres/public/orders',
      targetUrn: 'db://warehouse/analytics/daily_revenue',
      transformationType: 'aggregated',
      transformation: {
        sql: 'SELECT date_trunc(day, order_date), SUM(amount) FROM orders GROUP BY 1',
        expression: 'SUM(amount)',
      },
    })

    expect(edge.transformationType).toBe('aggregated')
    expect(edge.transformation.expression).toBe('SUM(amount)')
  })

  it('should handle edge with code transformation', () => {
    const edge = createEdgeV2({
      sourceUrn: 'api://payments/transactions',
      targetUrn: 'kafka://cluster/processed-transactions',
      transformationType: 'enriched',
      transformation: {
        code: 'data.enrich(with: customer_data)',
        config: { enrichmentSource: 'customer-service' },
      },
    })

    expect(edge.transformation.code).toContain('enrich')
    expect(edge.transformation.config!.enrichmentSource).toBe('customer-service')
  })
})
