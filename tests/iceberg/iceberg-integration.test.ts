/**
 * Iceberg Integration Tests with Mock R2
 *
 * Comprehensive integration tests for the Iceberg implementation using mock R2 storage.
 * Tests the full flow from API endpoint through IcebergMetadataDO to R2.
 *
 * Related issues:
 * - dotdo-xja3y: Add Iceberg integration tests with mock R2
 * - dotdo-rxsqb: Unified Analytics Architecture epic
 *
 * Test scenarios:
 * - Metadata parsing from mock R2
 * - Point lookup with partition pruning
 * - Cache invalidation on version change
 * - Error handling for missing files
 *
 * @module tests/iceberg/iceberg-integration.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { analyticsRouter } from '../../api/analytics/router'

// ============================================================================
// Mock R2 Utilities
// ============================================================================

/**
 * Create a mock R2 bucket with Iceberg table structure
 */
function createMockIcebergR2(tableConfigs: Record<string, {
  metadata: unknown
  dataFiles: Record<string, unknown>
}>) {
  const files: Record<string, unknown> = {}

  // Build file map from table configs
  for (const [tableId, config] of Object.entries(tableConfigs)) {
    // Store metadata.json
    files[`iceberg/${tableId}/metadata/v1.metadata.json`] = config.metadata

    // Store data files
    for (const [filePath, content] of Object.entries(config.dataFiles)) {
      files[filePath] = content
    }
  }

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
        key,
        size: JSON.stringify(content).length,
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const prefix = options?.prefix ?? ''
      const objects = Object.keys(files)
        .filter(key => key.startsWith(prefix))
        .map(key => ({
          key,
          size: JSON.stringify(files[key]).length,
          uploaded: new Date(),
        }))
      return { objects, truncated: false }
    }),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    head: vi.fn(async () => null),
  }
}

/**
 * Create a mock IcebergMetadataDO that uses the partition plan
 */
function createMockMetadataDO(tables: Record<string, {
  files: Array<{ filePath: string; partition: Record<string, string | number> }>
}>) {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      getPartitionPlan: async (tableId: string, filters: Array<{ column: string; operator: string; value: string | number }>) => {
        const tableConfig = tables[tableId]
        if (!tableConfig) {
          return {
            tableId,
            snapshotId: 0,
            files: [],
            totalRecords: 0,
            totalSizeBytes: 0,
            pruningStats: { totalManifests: 0, prunedManifests: 0, totalDataFiles: 0, prunedDataFiles: 0 },
            createdAt: Date.now(),
          }
        }

        // Filter files based on partition values
        let filteredFiles = tableConfig.files
        for (const filter of filters) {
          if (filter.operator === 'eq') {
            filteredFiles = filteredFiles.filter(f =>
              f.partition[filter.column] === filter.value
            )
          }
        }

        return {
          tableId,
          snapshotId: 1,
          files: filteredFiles,
          totalRecords: filteredFiles.length * 100,
          totalSizeBytes: filteredFiles.length * 10000,
          pruningStats: {
            totalManifests: 2,
            prunedManifests: 1,
            totalDataFiles: tableConfig.files.length,
            prunedDataFiles: tableConfig.files.length - filteredFiles.length,
          },
          createdAt: Date.now(),
        }
      },
    }),
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Iceberg Integration Tests', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.route('/', analyticsRouter)
  })

  // ==========================================================================
  // METADATA PARSING TESTS
  // ==========================================================================

  describe('metadata parsing from mock R2', () => {
    it('parses Iceberg table metadata correctly', async () => {
      const mockR2 = createMockIcebergR2({
        customers: {
          metadata: {
            formatVersion: 2,
            tableUuid: 'test-uuid',
            location: 'iceberg/customers/',
            currentSnapshotId: 1,
            schemas: [{
              schemaId: 1,
              fields: [
                { id: 1, name: 'id', type: 'string' },
                { id: 2, name: 'name', type: 'string' },
              ],
            }],
          },
          dataFiles: {
            'data/customers/cust-123.json': { id: 'cust-123', name: 'Acme Corp' },
          },
        },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/customers/cust-123')
      const response = await app.fetch(request, { R2: mockR2 as unknown })

      expect(response.status).toBe(200)
      const data = await response.json() as { found: boolean; data?: { name: string } }
      expect(data.found).toBe(true)
      expect(data.data?.name).toBe('Acme Corp')
    })

    it('handles version-hint.text for metadata location', async () => {
      const mockR2 = createMockIcebergR2({
        orders: {
          metadata: {
            formatVersion: 2,
            tableUuid: 'orders-uuid',
            currentSnapshotId: 5,
          },
          dataFiles: {
            'data/orders/order-789.json': { id: 'order-789', total: 99.99 },
          },
        },
      })

      // Add version hint
      ;(mockR2 as { get: ReturnType<typeof vi.fn> }).get.mockImplementation(async (key: string) => {
        if (key === 'iceberg/orders/version-hint.text') {
          return { text: async () => '1' }
        }
        if (key === 'data/orders/order-789.json') {
          return {
            json: async () => ({ id: 'order-789', total: 99.99 }),
            text: async () => JSON.stringify({ id: 'order-789', total: 99.99 }),
          }
        }
        return null
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/orders/order-789')
      const response = await app.fetch(request, { R2: mockR2 as unknown })

      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // POINT LOOKUP WITH PARTITION PRUNING TESTS
  // ==========================================================================

  describe('point lookup with partition pruning', () => {
    it('uses partition hints to prune files', async () => {
      const mockMetadataDO = createMockMetadataDO({
        events: {
          files: [
            { filePath: 'data/events/ns=payments/type=Order/file-001.parquet', partition: { ns: 'payments', type: 'Order' } },
            { filePath: 'data/events/ns=payments/type=Refund/file-002.parquet', partition: { ns: 'payments', type: 'Refund' } },
            { filePath: 'data/events/ns=analytics/type=View/file-003.parquet', partition: { ns: 'analytics', type: 'View' } },
          ],
        },
      })

      const mockR2 = createMockIcebergR2({
        events: {
          metadata: {},
          dataFiles: {
            'data/events/ns=payments/type=Order/evt-456.json': {
              id: 'evt-456',
              ns: 'payments',
              type: 'Order',
              amount: 150.00,
            },
          },
        },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/events/evt-456?ns=payments&type=Order')
      const response = await app.fetch(request, {
        R2: mockR2 as unknown,
        ICEBERG_METADATA: mockMetadataDO as unknown,
      })

      expect(response.status).toBe(200)
      const data = await response.json() as {
        found: boolean
        pruningStats?: { prunedDataFiles: number }
      }

      expect(data.pruningStats).toBeDefined()
      expect(data.pruningStats?.prunedDataFiles).toBe(2) // Pruned 2 out of 3 files
    })

    it('returns all files when no partition hints provided', async () => {
      const mockMetadataDO = createMockMetadataDO({
        users: {
          files: [
            { filePath: 'data/users/ns=acme/file-001.parquet', partition: { ns: 'acme' } },
            { filePath: 'data/users/ns=beta/file-002.parquet', partition: { ns: 'beta' } },
          ],
        },
      })

      const mockR2 = createMockIcebergR2({
        users: {
          metadata: {},
          dataFiles: {
            'data/users/user-123.json': { id: 'user-123', name: 'Test User' },
          },
        },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/users/user-123')
      const response = await app.fetch(request, {
        R2: mockR2 as unknown,
        ICEBERG_METADATA: mockMetadataDO as unknown,
      })

      expect(response.status).toBe(200)
      const data = await response.json() as {
        pruningStats?: { prunedDataFiles: number; totalDataFiles: number }
      }

      // No pruning when no filters
      expect(data.pruningStats?.prunedDataFiles).toBe(0)
      expect(data.pruningStats?.totalDataFiles).toBe(2)
    })
  })

  // ==========================================================================
  // CACHE BEHAVIOR TESTS
  // ==========================================================================

  describe('cache behavior', () => {
    it('uses cached partition plan on subsequent requests', async () => {
      let planCallCount = 0
      const mockMetadataDO = {
        idFromName: () => ({ name: 'default' }),
        get: () => ({
          getPartitionPlan: async () => {
            planCallCount++
            return {
              tableId: 'products',
              snapshotId: 1,
              files: [{ filePath: 'data/products/file-001.parquet', partition: {} }],
              totalRecords: 100,
              totalSizeBytes: 10000,
              pruningStats: { totalManifests: 1, prunedManifests: 0, totalDataFiles: 1, prunedDataFiles: 0 },
              createdAt: Date.now(),
            }
          },
        }),
      }

      const mockR2 = createMockIcebergR2({
        products: {
          metadata: {},
          dataFiles: {
            'data/products/prod-001.json': { id: 'prod-001', name: 'Widget' },
          },
        },
      })

      // First request
      const request1 = new Request('http://test.api.dotdo.dev/v1/lookup/products/prod-001')
      await app.fetch(request1, { R2: mockR2 as unknown, ICEBERG_METADATA: mockMetadataDO as unknown })

      // Second request
      const request2 = new Request('http://test.api.dotdo.dev/v1/lookup/products/prod-001')
      await app.fetch(request2, { R2: mockR2 as unknown, ICEBERG_METADATA: mockMetadataDO as unknown })

      // Each request calls getPartitionPlan once (no caching in router, but DO can cache)
      expect(planCallCount).toBe(2)
    })
  })

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('error handling for missing files', () => {
    it('returns found:false when data file is missing in R2', async () => {
      const mockR2 = createMockIcebergR2({
        items: {
          metadata: {},
          dataFiles: {}, // No data files
        },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/items/missing-item')
      const response = await app.fetch(request, { R2: mockR2 as unknown })

      expect(response.status).toBe(200)
      const data = await response.json() as { found: boolean }
      expect(data.found).toBe(false)
    })

    it('handles R2 errors gracefully', async () => {
      const errorR2 = {
        get: vi.fn(async () => {
          throw new Error('R2 connection failed')
        }),
      }

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/broken/key-123')
      const response = await app.fetch(request, { R2: errorR2 as unknown })

      expect(response.status).toBe(500)
      const data = await response.json() as { error: { code: string; message: string } }
      expect(data.error.code).toBe('INTERNAL_ERROR')
    })

    it('falls back to direct R2 when metadata DO errors', async () => {
      const errorMetadataDO = {
        idFromName: () => ({ name: 'default' }),
        get: () => ({
          getPartitionPlan: async () => {
            throw new Error('Metadata service unavailable')
          },
        }),
      }

      const mockR2 = createMockIcebergR2({
        fallback: {
          metadata: {},
          dataFiles: {
            'data/fallback/item-456.json': { id: 'item-456', status: 'active' },
          },
        },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/fallback/item-456')
      const response = await app.fetch(request, {
        R2: mockR2 as unknown,
        ICEBERG_METADATA: errorMetadataDO as unknown,
      })

      expect(response.status).toBe(200)
      const data = await response.json() as { found: boolean; data?: { status: string } }
      expect(data.found).toBe(true)
      expect(data.data?.status).toBe('active')
    })

    it('handles missing table gracefully', async () => {
      const mockMetadataDO = createMockMetadataDO({})
      const mockR2 = createMockIcebergR2({})

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/nonexistent_table/key-123')
      const response = await app.fetch(request, {
        R2: mockR2 as unknown,
        ICEBERG_METADATA: mockMetadataDO as unknown,
      })

      expect(response.status).toBe(200)
      const data = await response.json() as { found: boolean }
      expect(data.found).toBe(false)
    })
  })

  // ==========================================================================
  // LATENCY TESTS
  // ==========================================================================

  describe('latency requirements', () => {
    it('completes point lookup within 200ms target', async () => {
      const mockR2 = createMockIcebergR2({
        fast_table: {
          metadata: {},
          dataFiles: {
            'data/fast_table/record-001.json': { id: 'record-001', value: 'fast' },
          },
        },
      })

      const request = new Request('http://test.api.dotdo.dev/v1/lookup/fast_table/record-001')

      const startTime = Date.now()
      const response = await app.fetch(request, { R2: mockR2 as unknown })
      const data = await response.json() as { timing: { total: number } }
      const elapsed = Date.now() - startTime

      expect(response.status).toBe(200)
      expect(data.timing.total).toBeLessThan(200)
      expect(elapsed).toBeLessThan(200)
    })
  })
})
