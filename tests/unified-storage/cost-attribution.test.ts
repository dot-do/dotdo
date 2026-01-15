/**
 * Cost Attribution Tests - Per-Tenant Cost Tracking
 *
 * Tests for multi-tenant cost tracking in UnifiedStoreDO:
 * - Track writes per namespace/tenant
 * - Track reads per namespace/tenant
 * - Track Pipeline events per namespace
 * - Track SQLite operations per namespace
 * - Cost report API returns per-tenant breakdown
 * - Cost alerts when threshold exceeded
 * - Historical cost data retention
 * - Cost metrics exported to Prometheus
 *
 * NOTE: These tests are designed to FAIL because the implementation does not exist yet.
 * This is the TDD RED phase for Phase 4 Multi-tenant Hardening (do-35oa).
 *
 * @module tests/unified-storage/cost-attribution.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from implementation (will fail until implemented)
import { UnifiedStoreDO } from '../../objects/unified-storage/unified-store-do'
import type {
  CostMetricsCollector,
  TenantCostReport,
  CostAlertConfig,
  CostAlertEvent,
  HistoricalCostRecord,
} from '../../objects/unified-storage/cost-attribution'

// ============================================================================
// Mock Infrastructure
// ============================================================================

interface MockPipeline {
  events: unknown[]
  send(events: unknown[]): void
  clear(): void
}

function createMockPipeline(): MockPipeline {
  return {
    events: [],
    send(events: unknown[]) {
      this.events.push(...events)
    },
    clear() {
      this.events = []
    },
  }
}

interface MockSQLiteStorage {
  collections: Map<string, string>
  things: Map<string, { id: string; type: string; data: string }>
  exec: ReturnType<typeof vi.fn>
  queryCount: number
}

function createMockSQLiteStorage(): MockSQLiteStorage {
  const collections = new Map<string, string>()
  const things = new Map<string, { id: string; type: string; data: string }>()
  let queryCount = 0

  return {
    collections,
    things,
    get queryCount() {
      return queryCount
    },
    exec: vi.fn((sql: string, ...args: unknown[]) => {
      queryCount++
      if (sql.includes('INSERT') && sql.includes('columnar_store')) {
        const type = args[0] as string
        const data = args[1] as string
        collections.set(type, data)
        return { toArray: () => [] }
      }
      if (sql.includes('INSERT') && sql.includes('normalized_store')) {
        const type = args[0] as string
        const id = args[1] as string
        const data = args[2] as string
        things.set(`${type}:${id}`, { id, type, data })
        return { toArray: () => [] }
      }
      if (sql.includes('SELECT') && sql.includes('collections')) {
        return { toArray: () => Array.from(collections.entries()).map(([type, data]) => ({ type, data })) }
      }
      if (sql.includes('SELECT') && sql.includes('things')) {
        return { toArray: () => Array.from(things.values()) }
      }
      return { toArray: () => [] }
    }),
  }
}

interface MockDOState {
  id: { toString: () => string; name?: string }
  storage: {
    sql: MockSQLiteStorage
    get: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
  waitUntil: ReturnType<typeof vi.fn>
  blockConcurrencyWhile: ReturnType<typeof vi.fn>
  acceptWebSocket: ReturnType<typeof vi.fn>
  getWebSockets: ReturnType<typeof vi.fn>
}

function createMockDOState(name: string = 'test-tenant'): MockDOState {
  const kvStorage = new Map<string, unknown>()
  const sqlStorage = createMockSQLiteStorage()

  return {
    id: {
      toString: () => `unified-do-${name}`,
      name,
    },
    storage: {
      sql: sqlStorage,
      get: vi.fn(async <T>(key: string) => kvStorage.get(key) as T),
      put: vi.fn(async (key: string, value: unknown) => {
        kvStorage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => kvStorage.delete(key)),
      list: vi.fn(async (opts?: { prefix?: string }) => {
        const prefix = opts?.prefix ?? ''
        const result = new Map<string, unknown>()
        for (const [k, v] of kvStorage) {
          if (k.startsWith(prefix)) {
            result.set(k, v)
          }
        }
        return result
      }),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

interface MockEnv {
  PIPELINE: MockPipeline
  DO: DurableObjectNamespace
}

function createMockEnv(): MockEnv {
  return {
    PIPELINE: createMockPipeline(),
    DO: {} as DurableObjectNamespace,
  }
}

class MockWebSocket {
  readyState: number = 1
  sentMessages: string[] = []

  send(message: string): void {
    this.sentMessages.push(message)
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3
  }

  getLastMessage<T = unknown>(): T | null {
    if (this.sentMessages.length === 0) return null
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]) as T
  }
}

// ============================================================================
// Write Tracking Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Write Tracking', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-alpha')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Track writes per namespace/tenant', () => {
    it('should track total write count per tenant', async () => {
      const ws = new MockWebSocket()

      // Perform write operations
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      // Get cost metrics for this tenant
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-alpha')

      expect(tenantReport).toBeDefined()
      expect(tenantReport!.writes.count).toBe(5)
    })

    it('should track write bytes per tenant', async () => {
      const ws = new MockWebSocket()

      // Create entity with known data size
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice', description: 'x'.repeat(1000) },
      })

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-alpha')

      expect(tenantReport!.writes.bytes).toBeGreaterThan(1000)
    })

    it('should track writes by operation type (create, update, delete)', async () => {
      const ws = new MockWebSocket()

      // Create
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Update
      await unifiedDO.handleUpdate(ws as unknown as WebSocket, {
        type: 'update',
        id: 'op-2',
        $id: ack!.$id,
        data: { name: 'Alice Updated' },
      })

      // Delete
      await unifiedDO.handleDelete(ws as unknown as WebSocket, {
        type: 'delete',
        id: 'op-3',
        $id: ack!.$id,
      })

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-alpha')

      expect(tenantReport!.writes.byOperationType.create).toBe(1)
      expect(tenantReport!.writes.byOperationType.update).toBe(1)
      expect(tenantReport!.writes.byOperationType.delete).toBe(1)
    })

    it('should track writes by entity type', async () => {
      const ws = new MockWebSocket()

      // Create different entity types
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-2',
        $type: 'Order',
        data: { total: 100 },
      })

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-3',
        $type: 'Customer',
        data: { name: 'Bob' },
      })

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-alpha')

      expect(tenantReport!.writes.byEntityType['Customer']).toBe(2)
      expect(tenantReport!.writes.byEntityType['Order']).toBe(1)
    })

    it('should calculate write cost based on pricing model', async () => {
      const ws = new MockWebSocket()

      // Perform write
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice', description: 'x'.repeat(1000) },
      })

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-alpha')

      // Cost should be calculated (e.g., $0.000001 per write + $0.00000001 per byte)
      expect(tenantReport!.writes.cost).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Read Tracking Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Read Tracking', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-beta')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Track reads per namespace/tenant', () => {
    it('should track total read count per tenant', async () => {
      const ws = new MockWebSocket()

      // Create entity
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Perform multiple reads
      for (let i = 0; i < 10; i++) {
        await unifiedDO.get(ack!.$id)
      }

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-beta')

      expect(tenantReport!.reads.count).toBe(10)
    })

    it('should track read bytes per tenant', async () => {
      const ws = new MockWebSocket()

      // Create entity with known size
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice', payload: 'x'.repeat(500) },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Read entity
      await unifiedDO.get(ack!.$id)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-beta')

      expect(tenantReport!.reads.bytes).toBeGreaterThan(500)
    })

    it('should track cache hits vs cache misses separately', async () => {
      const ws = new MockWebSocket()

      // Create entity
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // First read - cache miss
      await unifiedDO.get(ack!.$id)

      // Subsequent reads - cache hits
      await unifiedDO.get(ack!.$id)
      await unifiedDO.get(ack!.$id)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-beta')

      expect(tenantReport!.reads.cacheHits).toBeGreaterThanOrEqual(2)
      expect(tenantReport!.reads.cacheMisses).toBeGreaterThanOrEqual(1)
    })

    it('should track reads by entity type', async () => {
      const ws = new MockWebSocket()

      // Create different entity types
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const customerAck = ws.getLastMessage<{ $id: string }>()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-2',
        $type: 'Order',
        data: { total: 100 },
      })

      const orderAck = ws.getLastMessage<{ $id: string }>()

      // Read entities
      await unifiedDO.get(customerAck!.$id)
      await unifiedDO.get(customerAck!.$id)
      await unifiedDO.get(orderAck!.$id)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-beta')

      expect(tenantReport!.reads.byEntityType['Customer']).toBe(2)
      expect(tenantReport!.reads.byEntityType['Order']).toBe(1)
    })

    it('should calculate read cost based on pricing model', async () => {
      const ws = new MockWebSocket()

      // Create and read entity
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()
      await unifiedDO.get(ack!.$id)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-beta')

      // Cost should be calculated (e.g., $0.0000001 per read)
      expect(tenantReport!.reads.cost).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Pipeline Events Tracking Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Pipeline Events Tracking', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-gamma')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Track Pipeline events per namespace', () => {
    it('should track total events emitted to Pipeline', async () => {
      const ws = new MockWebSocket()

      // Create entities (each should emit an event)
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      // Advance time to allow pipeline flush
      await vi.advanceTimersByTimeAsync(1000)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-gamma')

      expect(tenantReport!.pipeline.eventsEmitted).toBe(5)
    })

    it('should track Pipeline event bytes', async () => {
      const ws = new MockWebSocket()

      // Create entity with substantial data
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice', payload: 'x'.repeat(1000) },
      })

      await vi.advanceTimersByTimeAsync(1000)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-gamma')

      expect(tenantReport!.pipeline.bytesEmitted).toBeGreaterThan(1000)
    })

    it('should track events by event type', async () => {
      const ws = new MockWebSocket()

      // Create
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Update
      await unifiedDO.handleUpdate(ws as unknown as WebSocket, {
        type: 'update',
        id: 'op-2',
        $id: ack!.$id,
        data: { name: 'Alice Updated' },
      })

      // Delete
      await unifiedDO.handleDelete(ws as unknown as WebSocket, {
        type: 'delete',
        id: 'op-3',
        $id: ack!.$id,
      })

      await vi.advanceTimersByTimeAsync(1000)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-gamma')

      expect(tenantReport!.pipeline.byEventType['thing.created']).toBe(1)
      expect(tenantReport!.pipeline.byEventType['thing.updated']).toBe(1)
      expect(tenantReport!.pipeline.byEventType['thing.deleted']).toBe(1)
    })

    it('should calculate Pipeline cost based on events and bytes', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      await vi.advanceTimersByTimeAsync(1000)

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-gamma')

      // Pipeline cost (e.g., $0.00001 per event + $0.0000001 per byte)
      expect(tenantReport!.pipeline.cost).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// SQLite Operations Tracking Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: SQLite Operations Tracking', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-delta')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Track SQLite operations per namespace', () => {
    it('should track SQLite query count', async () => {
      const ws = new MockWebSocket()

      // Operations that trigger SQLite queries
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Trigger checkpoint which executes SQLite
      await unifiedDO.checkpoint?.('manual')

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-delta')

      expect(tenantReport!.sqlite.queryCount).toBeGreaterThan(0)
    })

    it('should track SQLite rows affected', async () => {
      const ws = new MockWebSocket()

      // Create multiple entities
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      // Checkpoint to persist to SQLite
      await unifiedDO.checkpoint?.('manual')

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-delta')

      expect(tenantReport!.sqlite.rowsAffected).toBeGreaterThanOrEqual(5)
    })

    it('should track SQLite storage bytes', async () => {
      const ws = new MockWebSocket()

      // Create entity with data
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice', payload: 'x'.repeat(1000) },
      })

      await unifiedDO.checkpoint?.('manual')

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-delta')

      expect(tenantReport!.sqlite.storageBytes).toBeGreaterThan(1000)
    })

    it('should track checkpoint operations separately', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Multiple checkpoints
      await unifiedDO.checkpoint?.('manual')
      await unifiedDO.checkpoint?.('timer')

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-delta')

      expect(tenantReport!.sqlite.checkpointCount).toBe(2)
    })

    it('should calculate SQLite cost based on operations and storage', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      await unifiedDO.checkpoint?.('manual')

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const tenantReport = costMetrics.getTenantReport('tenant-delta')

      // SQLite cost (e.g., based on query count and storage)
      expect(tenantReport!.sqlite.cost).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Cost Report API Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Cost Report API', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-epsilon')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Cost report API returns per-tenant breakdown', () => {
    it('should expose /cost-report endpoint', async () => {
      const request = new Request('https://test.api.dotdo.dev/cost-report')
      const response = await unifiedDO.fetch(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should return tenant ID in report', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const request = new Request('https://test.api.dotdo.dev/cost-report')
      const response = await unifiedDO.fetch(request)
      const report = (await response.json()) as TenantCostReport

      expect(report.tenantId).toBe('tenant-epsilon')
    })

    it('should include total cost in report', async () => {
      const ws = new MockWebSocket()

      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/cost-report')
      const response = await unifiedDO.fetch(request)
      const report = (await response.json()) as TenantCostReport

      expect(report.totalCost).toBeGreaterThan(0)
      expect(report.totalCost).toBe(
        report.writes.cost + report.reads.cost + report.pipeline.cost + report.sqlite.cost
      )
    })

    it('should include time range in report', async () => {
      const request = new Request('https://test.api.dotdo.dev/cost-report')
      const response = await unifiedDO.fetch(request)
      const report = (await response.json()) as TenantCostReport

      expect(report.period).toBeDefined()
      expect(report.period.start).toBeDefined()
      expect(report.period.end).toBeDefined()
    })

    it('should support time-filtered cost reports', async () => {
      const ws = new MockWebSocket()

      // Create at 12:00
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Advance time
      vi.setSystemTime(new Date('2026-01-14T13:00:00.000Z'))

      // Create at 13:00
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-2',
        $type: 'Customer',
        data: { name: 'Bob' },
      })

      // Request report for 12:00-12:30 only
      const request = new Request(
        'https://test.api.dotdo.dev/cost-report?start=2026-01-14T12:00:00.000Z&end=2026-01-14T12:30:00.000Z'
      )
      const response = await unifiedDO.fetch(request)
      const report = (await response.json()) as TenantCostReport

      // Should only include costs from the first hour
      expect(report.writes.count).toBe(1)
    })

    it('should include cost breakdown by category', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()
      await unifiedDO.get(ack!.$id)

      await vi.advanceTimersByTimeAsync(1000)
      await unifiedDO.checkpoint?.('manual')

      const request = new Request('https://test.api.dotdo.dev/cost-report')
      const response = await unifiedDO.fetch(request)
      const report = (await response.json()) as TenantCostReport

      expect(report.writes).toBeDefined()
      expect(report.reads).toBeDefined()
      expect(report.pipeline).toBeDefined()
      expect(report.sqlite).toBeDefined()
    })
  })
})

// ============================================================================
// Cost Alerts Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Cost Alerts', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-zeta')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Cost alerts when threshold exceeded', () => {
    it('should support configuring cost threshold per tenant', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      const alertConfig: CostAlertConfig = {
        tenantId: 'tenant-zeta',
        thresholds: {
          warning: 0.001, // $0.001
          critical: 0.01, // $0.01
        },
        enabled: true,
      }

      costMetrics.setAlertConfig(alertConfig)

      const config = costMetrics.getAlertConfig('tenant-zeta')
      expect(config).toBeDefined()
      expect(config!.thresholds.warning).toBe(0.001)
      expect(config!.thresholds.critical).toBe(0.01)
    })

    it('should emit warning alert when warning threshold exceeded', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      const alerts: CostAlertEvent[] = []
      costMetrics.onAlert((alert) => alerts.push(alert))

      costMetrics.setAlertConfig({
        tenantId: 'tenant-zeta',
        thresholds: {
          warning: 0.000001, // Very low threshold
          critical: 0.0001,
        },
        enabled: true,
      })

      const ws = new MockWebSocket()

      // Generate enough cost to trigger warning
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      expect(alerts.some((a) => a.level === 'warning')).toBe(true)
    })

    it('should emit critical alert when critical threshold exceeded', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      const alerts: CostAlertEvent[] = []
      costMetrics.onAlert((alert) => alerts.push(alert))

      costMetrics.setAlertConfig({
        tenantId: 'tenant-zeta',
        thresholds: {
          warning: 0.0000001,
          critical: 0.0000001, // Very low threshold
        },
        enabled: true,
      })

      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      expect(alerts.some((a) => a.level === 'critical')).toBe(true)
    })

    it('should include alert details (tenant, threshold, current cost)', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      const alerts: CostAlertEvent[] = []
      costMetrics.onAlert((alert) => alerts.push(alert))

      costMetrics.setAlertConfig({
        tenantId: 'tenant-zeta',
        thresholds: {
          warning: 0.0000001,
          critical: 1.0,
        },
        enabled: true,
      })

      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const alert = alerts.find((a) => a.level === 'warning')
      expect(alert).toBeDefined()
      expect(alert!.tenantId).toBe('tenant-zeta')
      expect(alert!.threshold).toBe(0.0000001)
      expect(alert!.currentCost).toBeGreaterThan(0)
      expect(alert!.timestamp).toBeDefined()
    })

    it('should not re-trigger alert until reset or new period', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      const alerts: CostAlertEvent[] = []
      costMetrics.onAlert((alert) => alerts.push(alert))

      costMetrics.setAlertConfig({
        tenantId: 'tenant-zeta',
        thresholds: {
          warning: 0.0000001,
          critical: 1.0,
        },
        enabled: true,
      })

      const ws = new MockWebSocket()

      // Multiple operations
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      // Should only trigger once per period
      const warningAlerts = alerts.filter((a) => a.level === 'warning')
      expect(warningAlerts.length).toBe(1)
    })

    it('should support disabling alerts', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      const alerts: CostAlertEvent[] = []
      costMetrics.onAlert((alert) => alerts.push(alert))

      costMetrics.setAlertConfig({
        tenantId: 'tenant-zeta',
        thresholds: {
          warning: 0.0000001,
          critical: 0.0000001,
        },
        enabled: false, // Disabled
      })

      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      expect(alerts.length).toBe(0)
    })
  })
})

// ============================================================================
// Historical Cost Data Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Historical Cost Data', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-eta')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Historical cost data retention', () => {
    it('should retain hourly cost summaries', async () => {
      const ws = new MockWebSocket()

      // Generate activity at 12:00
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Advance to next hour
      vi.setSystemTime(new Date('2026-01-14T13:00:00.000Z'))

      // Generate activity at 13:00
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-2',
        $type: 'Customer',
        data: { name: 'Bob' },
      })

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const history = costMetrics.getHistoricalData('tenant-eta', 'hourly')

      expect(history.length).toBeGreaterThanOrEqual(2)
      expect(history[0].period).toContain('2026-01-14T12')
      expect(history[1].period).toContain('2026-01-14T13')
    })

    it('should retain daily cost summaries', async () => {
      const ws = new MockWebSocket()

      // Generate activity on day 1
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Advance to next day
      vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

      // Generate activity on day 2
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-2',
        $type: 'Customer',
        data: { name: 'Bob' },
      })

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const history = costMetrics.getHistoricalData('tenant-eta', 'daily')

      expect(history.length).toBeGreaterThanOrEqual(2)
    })

    it('should persist historical data across hibernation', async () => {
      const ws = new MockWebSocket()

      // Generate activity
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Get history before hibernation
      let costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const historyBefore = costMetrics.getHistoricalData('tenant-eta', 'hourly')

      // Hibernate
      await unifiedDO.beforeHibernation?.()

      // Simulate restart
      unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      await unifiedDO.onStart?.()

      // Get history after wake
      costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const historyAfter = costMetrics.getHistoricalData('tenant-eta', 'hourly')

      expect(historyAfter.length).toBe(historyBefore.length)
    })

    it('should support querying historical data by date range', async () => {
      const ws = new MockWebSocket()

      // Generate activity over multiple days
      const days = ['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']

      for (const day of days) {
        vi.setSystemTime(new Date(`${day}T12:00:00.000Z`))
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${day}`,
          $type: 'Customer',
          data: { name: `Customer ${day}` },
        })
      }

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const history = costMetrics.getHistoricalData('tenant-eta', 'daily', {
        start: new Date('2026-01-13T00:00:00.000Z'),
        end: new Date('2026-01-15T23:59:59.999Z'),
      })

      // Should only include 13, 14, 15
      expect(history.length).toBe(3)
    })

    it('should aggregate historical data correctly', async () => {
      const ws = new MockWebSocket()

      // Generate known activity
      for (let i = 0; i < 10; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics
      const history = costMetrics.getHistoricalData('tenant-eta', 'hourly')

      const record = history[0] as HistoricalCostRecord
      expect(record.writes.count).toBe(10)
      expect(record.totalCost).toBeGreaterThan(0)
    })

    it('should apply retention policy to old data', async () => {
      const costMetrics = (unifiedDO as unknown as { costMetrics: CostMetricsCollector }).costMetrics

      // Set retention policy: 7 days for hourly, 90 days for daily
      costMetrics.setRetentionPolicy({
        hourly: 7, // days
        daily: 90, // days
      })

      // Generate old data (would normally be done over time)
      const ws = new MockWebSocket()
      vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-old',
        $type: 'Customer',
        data: { name: 'Old Customer' },
      })

      // Advance to current time (Jan 14)
      vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))

      // Trigger retention cleanup
      await costMetrics.cleanupOldData()

      const hourlyHistory = costMetrics.getHistoricalData('tenant-eta', 'hourly')

      // Old hourly data (>7 days) should be removed
      const oldHourlyRecords = hourlyHistory.filter(
        (h) => new Date(h.period) < new Date('2026-01-07T00:00:00.000Z')
      )
      expect(oldHourlyRecords.length).toBe(0)
    })
  })
})

// ============================================================================
// Prometheus Export Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Prometheus Export', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-theta')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Cost metrics exported to Prometheus', () => {
    it('should include cost metrics in /metrics endpoint', async () => {
      const ws = new MockWebSocket()

      // Generate activity
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should include cost-related metrics
      expect(text).toContain('dotdo_tenant_cost_total')
    })

    it('should export dotdo_tenant_cost_total gauge', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_tenant_cost_total gauge')
      expect(text).toContain('# HELP dotdo_tenant_cost_total')
      expect(text).toMatch(/dotdo_tenant_cost_total\{.*namespace="tenant-theta".*\}/)
    })

    it('should export dotdo_tenant_writes_cost gauge', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_tenant_writes_cost gauge')
      expect(text).toMatch(/dotdo_tenant_writes_cost\{.*namespace="tenant-theta".*\}/)
    })

    it('should export dotdo_tenant_reads_cost gauge', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()
      await unifiedDO.get(ack!.$id)

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_tenant_reads_cost gauge')
      expect(text).toMatch(/dotdo_tenant_reads_cost\{.*namespace="tenant-theta".*\}/)
    })

    it('should export dotdo_tenant_pipeline_cost gauge', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      await vi.advanceTimersByTimeAsync(1000)

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_tenant_pipeline_cost gauge')
      expect(text).toMatch(/dotdo_tenant_pipeline_cost\{.*namespace="tenant-theta".*\}/)
    })

    it('should export dotdo_tenant_sqlite_cost gauge', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      await unifiedDO.checkpoint?.('manual')

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_tenant_sqlite_cost gauge')
      expect(text).toMatch(/dotdo_tenant_sqlite_cost\{.*namespace="tenant-theta".*\}/)
    })

    it('should include namespace label on all cost metrics', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // All cost-related lines should have namespace label
      const costLines = text.split('\n').filter((line) => line.includes('dotdo_tenant_') && !line.startsWith('#'))

      for (const line of costLines) {
        expect(line).toContain('namespace="tenant-theta"')
      }
    })

    it('should export cost counter for writes/reads', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Counter for operations that accumulate
      expect(text).toContain('# TYPE dotdo_tenant_writes_total counter')
      expect(text).toContain('# TYPE dotdo_tenant_reads_total counter')
    })

    it('should export cost histogram for operation costs', async () => {
      const ws = new MockWebSocket()

      // Generate varying costs
      for (let i = 0; i < 10; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}`, payload: 'x'.repeat(i * 100) },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Histogram for cost distribution
      expect(text).toContain('# TYPE dotdo_tenant_operation_cost histogram')
      expect(text).toContain('dotdo_tenant_operation_cost_bucket')
      expect(text).toContain('dotdo_tenant_operation_cost_sum')
      expect(text).toContain('dotdo_tenant_operation_cost_count')
    })
  })
})

// ============================================================================
// Integration Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Cost Attribution: Integration', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState('tenant-integration')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track complete cost lifecycle for typical workflow', async () => {
    const ws = new MockWebSocket()

    // 1. Create entity (write + pipeline event)
    await unifiedDO.handleCreate(ws as unknown as WebSocket, {
      type: 'create',
      id: 'op-1',
      $type: 'Customer',
      data: { name: 'Alice', email: 'alice@example.com' },
    })

    const ack = ws.getLastMessage<{ $id: string }>()

    // 2. Read entity multiple times (reads)
    for (let i = 0; i < 5; i++) {
      await unifiedDO.get(ack!.$id)
    }

    // 3. Update entity (write + pipeline event)
    await unifiedDO.handleUpdate(ws as unknown as WebSocket, {
      type: 'update',
      id: 'op-2',
      $id: ack!.$id,
      data: { email: 'alice.updated@example.com' },
    })

    // 4. Checkpoint to SQLite
    await unifiedDO.checkpoint?.('manual')

    // 5. Flush pipeline events
    await vi.advanceTimersByTimeAsync(1000)

    // Verify comprehensive cost report
    const request = new Request('https://test.api.dotdo.dev/cost-report')
    const response = await unifiedDO.fetch(request)
    const report = (await response.json()) as TenantCostReport

    // Writes: create + update = 2
    expect(report.writes.count).toBe(2)
    expect(report.writes.cost).toBeGreaterThan(0)

    // Reads: 5 reads
    expect(report.reads.count).toBe(5)
    expect(report.reads.cost).toBeGreaterThan(0)

    // Pipeline: 2 events (created + updated)
    expect(report.pipeline.eventsEmitted).toBe(2)
    expect(report.pipeline.cost).toBeGreaterThan(0)

    // SQLite: checkpoint operations
    expect(report.sqlite.checkpointCount).toBeGreaterThanOrEqual(1)
    expect(report.sqlite.cost).toBeGreaterThan(0)

    // Total
    expect(report.totalCost).toBe(
      report.writes.cost + report.reads.cost + report.pipeline.cost + report.sqlite.cost
    )
  })

  it('should maintain accurate costs across multiple tenants in parallel', async () => {
    // Create multiple DO instances for different tenants
    const tenant1State = createMockDOState('tenant-1')
    const tenant2State = createMockDOState('tenant-2')
    const tenant3State = createMockDOState('tenant-3')

    const tenant1DO = new UnifiedStoreDO(tenant1State as unknown as DurableObjectState, mockEnv)
    const tenant2DO = new UnifiedStoreDO(tenant2State as unknown as DurableObjectState, mockEnv)
    const tenant3DO = new UnifiedStoreDO(tenant3State as unknown as DurableObjectState, mockEnv)

    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()
    const ws3 = new MockWebSocket()

    // Tenant 1: 10 writes
    for (let i = 0; i < 10; i++) {
      await tenant1DO.handleCreate(ws1 as unknown as WebSocket, {
        type: 'create',
        id: `t1-op-${i}`,
        $type: 'Customer',
        data: { name: `T1 Customer ${i}` },
      })
    }

    // Tenant 2: 5 writes
    for (let i = 0; i < 5; i++) {
      await tenant2DO.handleCreate(ws2 as unknown as WebSocket, {
        type: 'create',
        id: `t2-op-${i}`,
        $type: 'Customer',
        data: { name: `T2 Customer ${i}` },
      })
    }

    // Tenant 3: 3 writes
    for (let i = 0; i < 3; i++) {
      await tenant3DO.handleCreate(ws3 as unknown as WebSocket, {
        type: 'create',
        id: `t3-op-${i}`,
        $type: 'Customer',
        data: { name: `T3 Customer ${i}` },
      })
    }

    // Get reports
    const report1 = (await (await tenant1DO.fetch(new Request('https://test.api.dotdo.dev/cost-report'))).json()) as TenantCostReport
    const report2 = (await (await tenant2DO.fetch(new Request('https://test.api.dotdo.dev/cost-report'))).json()) as TenantCostReport
    const report3 = (await (await tenant3DO.fetch(new Request('https://test.api.dotdo.dev/cost-report'))).json()) as TenantCostReport

    // Verify isolation
    expect(report1.tenantId).toBe('tenant-1')
    expect(report1.writes.count).toBe(10)

    expect(report2.tenantId).toBe('tenant-2')
    expect(report2.writes.count).toBe(5)

    expect(report3.tenantId).toBe('tenant-3')
    expect(report3.writes.count).toBe(3)

    // Costs should be proportional
    expect(report1.totalCost).toBeGreaterThan(report2.totalCost)
    expect(report2.totalCost).toBeGreaterThan(report3.totalCost)
  })

  it('should survive hibernation and maintain accurate cost tracking', async () => {
    const ws = new MockWebSocket()

    // Generate activity before hibernation
    for (let i = 0; i < 5; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `pre-hib-${i}`,
        $type: 'Customer',
        data: { name: `Customer ${i}` },
      })
    }

    // Get report before hibernation
    let response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/cost-report'))
    const reportBefore = (await response.json()) as TenantCostReport

    // Hibernate
    await unifiedDO.beforeHibernation?.()

    // Simulate restart
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    await unifiedDO.onStart?.()

    // Generate more activity after wake
    for (let i = 0; i < 3; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `post-hib-${i}`,
        $type: 'Customer',
        data: { name: `Customer ${i}` },
      })
    }

    // Get report after wake
    response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/cost-report'))
    const reportAfter = (await response.json()) as TenantCostReport

    // Should include both pre and post hibernation activity
    expect(reportAfter.writes.count).toBe(8) // 5 + 3
    expect(reportAfter.totalCost).toBeGreaterThan(reportBefore.totalCost)
  })
})
