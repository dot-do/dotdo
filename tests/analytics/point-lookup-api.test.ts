/**
 * Point Lookup API Endpoint Tests
 *
 * TDD RED phase tests for the Iceberg point lookup API endpoint integration.
 * Tests the GET /api/v1/lookup/:table/:key endpoint that routes to IcebergMetadataDO.
 *
 * Related issues:
 * - dotdo-e7ety: Implement Point Lookup Path (Path A) for Iceberg
 * - dotdo-rxsqb: Unified Analytics Architecture epic
 *
 * Acceptance criteria:
 * - Point lookup returns correct row
 * - Uses partition pruning to minimize files read
 * - Latency < 200ms for single key lookup
 * - Handles missing key gracefully
 *
 * @module tests/analytics/point-lookup-api.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { analyticsRouter } from '../../api/analytics/router'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a mock R2 bucket
 */
function createMockR2(files: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => {
      const content = files[key]
      if (content === undefined) return null

      return {
        text: async () => JSON.stringify(content),
        json: async () => content,
        arrayBuffer: async () => {
          const encoder = new TextEncoder()
          return encoder.encode(JSON.stringify(content)).buffer
        },
        body: null,
        bodyUsed: false,
        writeHttpMetadata: () => {},
        httpEtag: 'etag-123',
        etag: 'etag-123',
        httpMetadata: {},
        customMetadata: {},
        key,
        size: JSON.stringify(content).length,
        uploaded: new Date(),
        checksums: {},
        storageClass: 'Standard',
      }
    }),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    head: vi.fn(async () => null),
  }
}

/**
 * Create a mock IcebergMetadataDO namespace
 */
function createMockIcebergMetadata(
  planResponse: {
    files: Array<{ filePath: string; partition: Record<string, string | number> }>
    totalRecords: number
    totalSizeBytes: number
  },
  decodeResponse: Record<string, unknown> | null = null
) {
  let partitionPlanCalled = false
  let decodeRowCalled = false

  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      getPartitionPlan: async (tableId: string, filters: unknown[]) => {
        partitionPlanCalled = true
        return {
          tableId,
          snapshotId: 1,
          files: planResponse.files,
          totalRecords: planResponse.totalRecords,
          totalSizeBytes: planResponse.totalSizeBytes,
          pruningStats: {
            totalManifests: 2,
            prunedManifests: 1,
            totalDataFiles: 10,
            prunedDataFiles: 9,
          },
          createdAt: Date.now(),
        }
      },
      decodeRow: async (filePath: string, key: string) => {
        decodeRowCalled = true
        return decodeResponse
      },
    }),
    _wasPlanCalled: () => partitionPlanCalled,
    _wasDecodeCalled: () => decodeRowCalled,
  }
}

/**
 * Mock environment for testing
 */
interface MockEnv {
  R2?: ReturnType<typeof createMockR2>
  ICEBERG_METADATA?: ReturnType<typeof createMockIcebergMetadata>
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Point Lookup API Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = new Hono<{ Bindings: MockEnv }>()
    app.route('/', analyticsRouter)
  })

  // ==========================================================================
  // INPUT VALIDATION TESTS
  // ==========================================================================

  describe('input validation', () => {
    it('returns 400 for invalid table name with special characters', async () => {
      const request = new Request('http://test.api.dotdo.dev/v1/lookup/table@invalid/key123')

      const response = await app.fetch(request, {})
      const data = await response.json() as { error?: { code: string } }

      expect(response.status).toBe(400)
      expect(data.error?.code).toBe('INVALID_QUERY')
    })

    it('returns 400 for empty key', async () => {
      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/')

      const response = await app.fetch(request, {})
      // Empty key might result in 404 or 400 depending on routing
      expect([400, 404]).toContain(response.status)
    })

    it('accepts valid table names with underscores', async () => {
      const mockR2 = createMockR2({})
      const request = new Request('http://test.api.dotdo.dev/v1/lookup/user_accounts/key123')

      const response = await app.fetch(request, { R2: mockR2 })
      // Should not return 400 for validation error
      expect(response.status).not.toBe(400)
    })

    it('accepts alphanumeric table names starting with letter', async () => {
      const mockR2 = createMockR2({})
      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users123/key456')

      const response = await app.fetch(request, { R2: mockR2 })
      expect(response.status).not.toBe(400)
    })
  })

  // ==========================================================================
  // ICEBERG METADATA INTEGRATION TESTS
  // ==========================================================================

  describe('IcebergMetadataDO integration', () => {
    it('uses IcebergMetadataDO for partition planning when available', async () => {
      const mockMetadata = createMockIcebergMetadata({
        files: [
          { filePath: 'data/customers/ns=acme/file-001.parquet', partition: { ns: 'acme' } },
        ],
        totalRecords: 1000,
        totalSizeBytes: 50000,
      })

      const mockR2 = createMockR2({
        'data/customers/ns=acme/file-001.parquet': { id: 'cust-123', name: 'Acme Corp' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/customers/cust-123?ns=acme')

      const response = await app.fetch(request, {
        R2: mockR2,
        ICEBERG_METADATA: mockMetadata as unknown as MockEnv['ICEBERG_METADATA'],
      })

      // TODO: This test is expected to FAIL until the implementation routes to metadata DO
      expect(mockMetadata._wasPlanCalled()).toBe(true)
    })

    it('includes partition pruning stats in timing', async () => {
      const mockMetadata = createMockIcebergMetadata({
        files: [{ filePath: 'data/orders/date=2024-01-15/file-001.parquet', partition: { date: '2024-01-15' } }],
        totalRecords: 500,
        totalSizeBytes: 25000,
      })

      const mockR2 = createMockR2({
        'data/orders/date=2024-01-15/file-001.parquet': { id: 'order-789', total: 99.99 },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/orders/order-789?date=2024-01-15')

      const response = await app.fetch(request, {
        R2: mockR2,
        ICEBERG_METADATA: mockMetadata as unknown as MockEnv['ICEBERG_METADATA'],
      })

      const data = await response.json() as {
        timing?: {
          total: number
          metadataLookup: number
          partitionPrune: number
          dataFetch: number
        }
        pruningStats?: {
          totalManifests: number
          prunedManifests: number
          totalDataFiles: number
          prunedDataFiles: number
        }
      }

      // TODO: This test is expected to FAIL until the implementation includes pruning stats
      expect(data.timing?.partitionPrune).toBeTypeOf('number')
      expect(data.pruningStats?.prunedDataFiles).toBeGreaterThan(0)
    })

    it('passes partition filters from query params to metadata DO', async () => {
      let capturedFilters: unknown[] = []

      const mockMetadata = {
        idFromName: () => ({ name: 'default' }),
        get: () => ({
          getPartitionPlan: async (tableId: string, filters: unknown[]) => {
            capturedFilters = filters
            return {
              tableId,
              snapshotId: 1,
              files: [],
              totalRecords: 0,
              totalSizeBytes: 0,
              pruningStats: { totalManifests: 0, prunedManifests: 0, totalDataFiles: 0, prunedDataFiles: 0 },
              createdAt: Date.now(),
            }
          },
        }),
      }

      const mockR2 = createMockR2({})

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/events/evt-456?ns=payments.do&type=Transaction&date=2024-01-20')

      await app.fetch(request, {
        R2: mockR2,
        ICEBERG_METADATA: mockMetadata as unknown as MockEnv['ICEBERG_METADATA'],
      })

      // TODO: This test is expected to FAIL until the implementation passes filters
      expect(capturedFilters).toContainEqual(
        expect.objectContaining({ column: 'ns', operator: 'eq', value: 'payments.do' })
      )
      expect(capturedFilters).toContainEqual(
        expect.objectContaining({ column: 'type', operator: 'eq', value: 'Transaction' })
      )
    })
  })

  // ==========================================================================
  // RESPONSE STRUCTURE TESTS
  // ==========================================================================

  describe('response structure', () => {
    it('returns found:true with data when record exists', async () => {
      const testData = { id: 'user-123', name: 'John Doe', email: 'john@example.com' }
      const mockR2 = createMockR2({
        'data/users/user-123.json': testData,
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as { found: boolean; data?: Record<string, unknown> }

      expect(response.status).toBe(200)
      expect(data.found).toBe(true)
      expect(data.data).toEqual(testData)
    })

    it('returns found:false when record does not exist', async () => {
      const mockR2 = createMockR2({})

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/nonexistent-key')

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as { found: boolean }

      expect(response.status).toBe(200)
      expect(data.found).toBe(false)
    })

    it('includes timing breakdown in response', async () => {
      const mockR2 = createMockR2({
        'data/users/user-123.json': { id: 'user-123' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as {
        timing: {
          total: number
          metadataLookup: number
          partitionPrune: number
          dataFetch: number
        }
      }

      expect(response.status).toBe(200)
      expect(data.timing).toBeDefined()
      expect(data.timing.total).toBeTypeOf('number')
      expect(data.timing.total).toBeGreaterThanOrEqual(0)
      expect(data.timing.metadataLookup).toBeTypeOf('number')
      expect(data.timing.partitionPrune).toBeTypeOf('number')
      expect(data.timing.dataFetch).toBeTypeOf('number')
    })

    it('includes source information in response', async () => {
      const mockR2 = createMockR2({
        'data/orders/ns=acme/date=2024-01-15/order-789.json': { id: 'order-789' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/orders/order-789?ns=acme&date=2024-01-15')

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as {
        source: {
          table: string
          partition: string
          file: string
        }
      }

      expect(response.status).toBe(200)
      expect(data.source).toBeDefined()
      expect(data.source.table).toBe('orders')
      expect(data.source.partition).toContain('ns=acme')
    })
  })

  // ==========================================================================
  // PARTITION HINT TESTS
  // ==========================================================================

  describe('partition hints', () => {
    it('uses ns partition hint to construct path', async () => {
      const mockR2 = createMockR2({
        'data/users/ns=payments.do/user-123.json': { id: 'user-123', ns: 'payments.do' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123?ns=payments.do')

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as { found: boolean; data?: { ns?: string } }

      expect(response.status).toBe(200)
      expect(data.found).toBe(true)
      expect(data.data?.ns).toBe('payments.do')
    })

    it('uses multiple partition hints to construct nested path', async () => {
      const mockR2 = createMockR2({
        'data/events/ns=acme/type=Order/date=2024-01-15/evt-456.json': {
          id: 'evt-456',
          ns: 'acme',
          type: 'Order',
          date: '2024-01-15',
        },
      })

      const request = new Request(
        'http://test.api.dotdo.dev/v1/lookup/events/evt-456?ns=acme&type=Order&date=2024-01-15'
      )

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as { found: boolean }

      expect(response.status).toBe(200)
      expect(data.found).toBe(true)
    })

    it('falls back to non-partitioned path when no hints provided', async () => {
      const mockR2 = createMockR2({
        'data/config/app-settings.json': { theme: 'dark', locale: 'en-US' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/config/app-settings')

      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as { found: boolean }

      expect(response.status).toBe(200)
      expect(data.found).toBe(true)
    })
  })

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('error handling', () => {
    it('returns 500 when R2 fetch fails', async () => {
      const mockR2 = {
        get: vi.fn(async () => {
          throw new Error('R2 unavailable')
        }),
      }

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')

      const response = await app.fetch(request, { R2: mockR2 as unknown as MockEnv['R2'] })
      const data = await response.json() as { error?: { code: string } }

      expect(response.status).toBe(500)
      expect(data.error?.code).toBe('INTERNAL_ERROR')
    })

    it('returns 200 with found:false when no R2 binding', async () => {
      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')

      const response = await app.fetch(request, {})
      const data = await response.json() as { found: boolean }

      expect(response.status).toBe(200)
      expect(data.found).toBe(false)
    })

    it('handles metadata DO errors gracefully', async () => {
      const mockMetadata = {
        idFromName: () => ({ name: 'default' }),
        get: () => ({
          getPartitionPlan: async () => {
            throw new Error('Metadata unavailable')
          },
        }),
      }

      const mockR2 = createMockR2({
        'data/users/user-123.json': { id: 'user-123' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')

      const response = await app.fetch(request, {
        R2: mockR2,
        ICEBERG_METADATA: mockMetadata as unknown as MockEnv['ICEBERG_METADATA'],
      })

      // Should fall back to direct R2 lookup
      const data = await response.json() as { found: boolean; error?: unknown }

      // Either succeeds with fallback or returns error
      expect([200, 500]).toContain(response.status)
      if (response.status === 200) {
        expect(data.found).toBe(true)
      }
    })
  })

  // ==========================================================================
  // LATENCY TARGET TESTS
  // ==========================================================================

  describe('latency targets', () => {
    it('completes point lookup within 200ms target', async () => {
      const mockR2 = createMockR2({
        'data/users/user-123.json': { id: 'user-123', name: 'Fast User' },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')

      const startTime = Date.now()
      const response = await app.fetch(request, { R2: mockR2 })
      const data = await response.json() as { timing: { total: number } }
      const elapsed = Date.now() - startTime

      expect(response.status).toBe(200)
      // In a test environment this should be fast
      // In production, we'd have actual network latency
      expect(data.timing.total).toBeLessThan(200)
    })
  })
})
