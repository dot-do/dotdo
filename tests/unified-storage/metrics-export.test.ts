/**
 * RED Phase Tests for Prometheus Metrics Export
 *
 * Tests for Prometheus-compatible metrics export from UnifiedStoreDO:
 * - /metrics endpoint returns Prometheus text format
 * - Counter metrics (writes_total, reads_total, events_emitted_total)
 * - Histogram metrics (operation_duration_seconds, batch_size)
 * - Gauge metrics (buffer_size, dirty_count, replication_lag)
 * - Labels include namespace, operation_type, entity_type
 * - Metrics survive DO hibernation and wake cycle
 * - Metric names follow Prometheus naming conventions
 * - Help text included for each metric
 *
 * These tests will FAIL until the /metrics endpoint and PrometheusExporter
 * are implemented.
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 * @module tests/unified-storage/metrics-export.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// Import implementation and types (will fail until implemented)
// ============================================================================

import { UnifiedStoreDO } from '../../objects/unified-storage/unified-store-do'
import type { MetricsSnapshot } from '../../objects/unified-storage/metrics'

// Types for the Prometheus exporter that will be implemented
interface PrometheusExporter {
  export(): string
  exportMetric(name: string): string | null
  getMetricNames(): string[]
}

interface PrometheusMetric {
  name: string
  type: 'counter' | 'gauge' | 'histogram' | 'summary'
  help: string
  labels: Record<string, string>[]
  value?: number
  buckets?: { le: number; count: number }[]
  sum?: number
  count?: number
}

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
  things: Map<string, string>
  exec: ReturnType<typeof vi.fn>
}

function createMockSQLiteStorage(): MockSQLiteStorage {
  // Note: Checkpointer writes to columnar_store/normalized_store, but recovery reads from collections/things
  // For simplicity, we map both to the same storage (collections = columnar_store, things = normalized_store)
  const collections = new Map<string, string>()
  const things = new Map<string, { id: string; type: string; data: string }>()

  return {
    collections,
    things,
    exec: vi.fn((sql: string, ...args: unknown[]) => {
      // Handle INSERT for columnar_store (checkpointer writes here)
      if (sql.includes('INSERT') && sql.includes('columnar_store')) {
        const type = args[0] as string
        const data = args[1] as string
        collections.set(type, data)
        return { toArray: () => [] }
      }
      // Handle INSERT for normalized_store (checkpointer writes here)
      if (sql.includes('INSERT') && sql.includes('normalized_store')) {
        const type = args[0] as string
        const id = args[1] as string
        const data = args[2] as string
        things.set(`${type}:${id}`, { id, type, data })
        return { toArray: () => [] }
      }
      // Handle SELECT from collections (recovery reads here, maps to columnar_store)
      if (sql.includes('SELECT') && sql.includes('collections')) {
        return { toArray: () => Array.from(collections.entries()).map(([type, data]) => ({ type, data })) }
      }
      // Handle SELECT from columnar_store (alternative path)
      if (sql.includes('SELECT') && sql.includes('columnar_store')) {
        return { toArray: () => Array.from(collections.entries()).map(([type, data]) => ({ type, data })) }
      }
      // Handle SELECT from things (recovery reads here)
      if (sql.includes('SELECT') && sql.includes('things')) {
        return { toArray: () => Array.from(things.values()) }
      }
      // Handle SELECT from normalized_store (alternative path)
      if (sql.includes('SELECT') && sql.includes('normalized_store')) {
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

function createMockDOState(name: string = 'test-metrics'): MockDOState {
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
// Prometheus Text Format Parsing Utilities
// ============================================================================

/**
 * Parse Prometheus text format into structured metrics
 */
function parsePrometheusText(text: string): Map<string, PrometheusMetric> {
  const metrics = new Map<string, PrometheusMetric>()
  const lines = text.split('\n')

  let currentMetric: Partial<PrometheusMetric> | null = null
  let currentName: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      // Parse HELP and TYPE comments
      if (trimmed.startsWith('# HELP ')) {
        const match = trimmed.match(/^# HELP (\w+) (.+)$/)
        if (match) {
          currentName = match[1]
          currentMetric = { name: match[1], help: match[2], labels: [] }
        }
      } else if (trimmed.startsWith('# TYPE ')) {
        const match = trimmed.match(/^# TYPE (\w+) (\w+)$/)
        if (match && currentMetric && match[1] === currentName) {
          currentMetric.type = match[2] as PrometheusMetric['type']
        }
      }
      continue
    }

    // Parse metric line: metric_name{label="value"} value
    const metricMatch = trimmed.match(/^(\w+)(\{[^}]*\})?\s+([\d.eE+-]+|NaN|Inf|-Inf)$/)
    if (metricMatch) {
      const [, name, labelsStr, valueStr] = metricMatch

      // For histograms, _bucket/_sum/_count are suffixes on the base metric name
      // But for counters, _total IS the metric name; for gauges, _count can BE the metric name
      // Only strip histogram-specific suffixes (_bucket, _sum, _count for histograms)
      const isHistogramSuffix = name.endsWith('_bucket') ||
        (currentMetric?.type === 'histogram' && (name.endsWith('_sum') || name.endsWith('_count')))
      const baseName = isHistogramSuffix
        ? name.replace(/_bucket$|_sum$|_count$/, '')
        : name

      if (!metrics.has(baseName) && currentMetric && currentName === baseName) {
        metrics.set(baseName, currentMetric as PrometheusMetric)
      }

      // Parse labels
      const labels: Record<string, string> = {}
      if (labelsStr) {
        const labelMatches = labelsStr.matchAll(/(\w+)="([^"]*)"/g)
        for (const [, key, val] of labelMatches) {
          labels[key] = val
        }
      }

      const metric = metrics.get(baseName)
      if (metric) {
        metric.labels.push(labels)
        const value = parseFloat(valueStr)

        if (name.endsWith('_sum') && metric.type === 'histogram') {
          metric.sum = value
        } else if (name.endsWith('_count') && metric.type === 'histogram') {
          metric.count = value
        } else if (name.endsWith('_bucket')) {
          metric.buckets = metric.buckets ?? []
          metric.buckets.push({ le: parseFloat(labels.le ?? 'Inf'), count: value })
        } else {
          metric.value = value
        }
      }
    }
  }

  return metrics
}

/**
 * Check if metric name follows Prometheus naming conventions
 * @see https://prometheus.io/docs/practices/naming/
 */
function isValidPrometheusName(name: string): boolean {
  // Must match [a-zA-Z_:][a-zA-Z0-9_:]*
  // Should use snake_case
  // Should include unit suffix (_seconds, _bytes, _total, etc.)
  return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)
}

/**
 * Check if metric has proper unit suffix
 */
function hasUnitSuffix(name: string): boolean {
  const validSuffixes = [
    '_total',
    '_seconds',
    '_bytes',
    '_ratio',
    '_count',
    '_info',
    '_created',
    '_percent',
  ]
  return validSuffixes.some(suffix => name.endsWith(suffix)) ||
    // Gauges without suffix are also valid
    !name.includes('_')
}

// ============================================================================
// /metrics Endpoint Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus /metrics Endpoint', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Endpoint Response Format', () => {
    it('should expose /metrics endpoint via fetch', async () => {
      // This test will FAIL until /metrics endpoint is implemented
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)

      expect(response.status).toBe(200)
    })

    it('should return Content-Type: text/plain; version=0.0.4', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)

      expect(response.headers.get('Content-Type')).toBe('text/plain; version=0.0.4; charset=utf-8')
    })

    it('should return valid Prometheus text format', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should contain at least one metric with HELP and TYPE
      expect(text).toContain('# HELP')
      expect(text).toContain('# TYPE')

      // Should be parseable
      const metrics = parsePrometheusText(text)
      expect(metrics.size).toBeGreaterThan(0)
    })

    it('should include namespace label on all metrics', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should include namespace label
      expect(text).toContain('namespace="test-metrics"')
    })
  })
})

// ============================================================================
// Counter Metrics Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Counter Metrics', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('writes_total Counter', () => {
    it('should export dotdo_writes_total counter', async () => {
      const ws = new MockWebSocket()

      // Perform some write operations
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should have writes_total counter
      expect(text).toContain('# TYPE dotdo_writes_total counter')
      expect(text).toContain('dotdo_writes_total')

      const metrics = parsePrometheusText(text)
      const writesMetric = metrics.get('dotdo_writes_total')
      expect(writesMetric).toBeDefined()
      expect(writesMetric!.type).toBe('counter')
      expect(writesMetric!.value).toBeGreaterThanOrEqual(5)
    })

    it('should include operation_type label on writes_total', async () => {
      const ws = new MockWebSocket()

      // Create
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Update
      await unifiedDO.handleUpdate(ws as unknown as WebSocket, {
        type: 'update',
        id: 'op-2',
        $id: ack!.$id,
        data: { name: 'updated' },
      })

      // Delete
      await unifiedDO.handleDelete(ws as unknown as WebSocket, {
        type: 'delete',
        id: 'op-3',
        $id: ack!.$id,
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should have separate counters for create, update, delete
      expect(text).toContain('operation_type="create"')
      expect(text).toContain('operation_type="update"')
      expect(text).toContain('operation_type="delete"')
    })

    it('should include entity_type label on writes_total', async () => {
      const ws = new MockWebSocket()

      // Create entities of different types
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

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should have entity_type labels
      expect(text).toContain('entity_type="Customer"')
      expect(text).toContain('entity_type="Order"')
    })
  })

  describe('reads_total Counter', () => {
    it('should export dotdo_reads_total counter', async () => {
      const ws = new MockWebSocket()

      // Create and read
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Perform reads
      for (let i = 0; i < 10; i++) {
        await unifiedDO.get(ack!.$id)
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_reads_total counter')
      expect(text).toContain('dotdo_reads_total')

      // The reads_total counter is split by cache_status (hit/miss)
      // We need to sum all values across different label combinations
      // Parse all lines to get total reads
      const lines = text.split('\n').filter(l => l.startsWith('dotdo_reads_total{'))
      const totalReads = lines.reduce((sum, line) => {
        const match = line.match(/}\s+(\d+)$/)
        return sum + (match ? parseInt(match[1], 10) : 0)
      }, 0)

      expect(totalReads).toBeGreaterThanOrEqual(10)
    })

    it('should track cache hits vs misses in reads', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should have cache_status label
      expect(text).toMatch(/dotdo_reads_total\{.*cache_status="hit".*\}/)
      // Or separate metrics for hits/misses
      expect(text).toMatch(/dotdo_cache_hits_total|cache_status="hit"/)
    })
  })

  describe('events_emitted_total Counter', () => {
    it('should export dotdo_events_emitted_total counter', async () => {
      const ws = new MockWebSocket()

      // Emit events via writes
      for (let i = 0; i < 7; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Event',
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_events_emitted_total counter')
      expect(text).toContain('dotdo_events_emitted_total')

      const metrics = parsePrometheusText(text)
      const eventsMetric = metrics.get('dotdo_events_emitted_total')
      expect(eventsMetric).toBeDefined()
      expect(eventsMetric!.value).toBeGreaterThanOrEqual(7)
    })

    it('should include event_type label', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should label by event type
      expect(text).toContain('event_type="thing.created"')
    })
  })

  describe('checkpoints_total Counter', () => {
    it('should export dotdo_checkpoints_total counter', async () => {
      const ws = new MockWebSocket()

      // Create data and trigger checkpoint
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      await unifiedDO.checkpoint?.('manual')

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_checkpoints_total counter')
      expect(text).toContain('dotdo_checkpoints_total')

      const metrics = parsePrometheusText(text)
      const checkpointsMetric = metrics.get('dotdo_checkpoints_total')
      expect(checkpointsMetric).toBeDefined()
      expect(checkpointsMetric!.value).toBeGreaterThanOrEqual(1)
    })

    it('should include trigger_type label', async () => {
      // Trigger different checkpoint types
      await unifiedDO.checkpoint?.('timer')
      await unifiedDO.checkpoint?.('threshold')
      await unifiedDO.checkpoint?.('hibernation')

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('trigger_type="timer"')
      expect(text).toContain('trigger_type="threshold"')
      expect(text).toContain('trigger_type="hibernation"')
    })
  })
})

// ============================================================================
// Histogram Metrics Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Histogram Metrics', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('operation_duration_seconds Histogram', () => {
    it('should export dotdo_operation_duration_seconds histogram', async () => {
      const ws = new MockWebSocket()

      // Perform operations to generate latency data
      for (let i = 0; i < 20; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_operation_duration_seconds histogram')
      expect(text).toContain('dotdo_operation_duration_seconds_bucket')
      expect(text).toContain('dotdo_operation_duration_seconds_sum')
      expect(text).toContain('dotdo_operation_duration_seconds_count')
    })

    it('should have standard histogram buckets', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should have standard latency buckets
      // Typical buckets: 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, +Inf
      expect(text).toContain('le="0.001"')
      expect(text).toContain('le="0.01"')
      expect(text).toContain('le="0.1"')
      expect(text).toContain('le="1"')
      expect(text).toContain('le="+Inf"')
    })

    it('should include operation_type label', async () => {
      const ws = new MockWebSocket()

      // Different operations
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()
      await unifiedDO.get(ack!.$id)

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toMatch(/dotdo_operation_duration_seconds_bucket\{.*operation_type="create"/)
      expect(text).toMatch(/dotdo_operation_duration_seconds_bucket\{.*operation_type="read"/)
    })
  })

  describe('batch_size Histogram', () => {
    it('should export dotdo_batch_size histogram', async () => {
      const ws = new MockWebSocket()

      // Create batch operations
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      // Trigger a flush/checkpoint
      await unifiedDO.checkpoint?.('manual')

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_batch_size histogram')
      expect(text).toContain('dotdo_batch_size_bucket')
      expect(text).toContain('dotdo_batch_size_sum')
      expect(text).toContain('dotdo_batch_size_count')
    })

    it('should include batch_type label (checkpoint, pipeline)', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should differentiate between batch types
      expect(text).toMatch(/batch_type="checkpoint"|batch_type="pipeline"/)
    })
  })

  describe('checkpoint_duration_seconds Histogram', () => {
    it('should export dotdo_checkpoint_duration_seconds histogram', async () => {
      const ws = new MockWebSocket()

      // Create data and checkpoint
      for (let i = 0; i < 10; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      await unifiedDO.checkpoint?.('manual')

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_checkpoint_duration_seconds histogram')
      expect(text).toContain('dotdo_checkpoint_duration_seconds_bucket')
    })
  })

  describe('recovery_duration_seconds Histogram', () => {
    it('should export dotdo_recovery_duration_seconds histogram', async () => {
      // Trigger recovery
      await unifiedDO.onStart?.()

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_recovery_duration_seconds histogram')
      expect(text).toContain('dotdo_recovery_duration_seconds_bucket')
    })

    it('should include recovery_source label', async () => {
      await unifiedDO.onStart?.()

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should indicate recovery source
      expect(text).toMatch(/recovery_source="sqlite"|recovery_source="iceberg"|recovery_source="empty"/)
    })
  })
})

// ============================================================================
// Gauge Metrics Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Gauge Metrics', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('buffer_size Gauge', () => {
    it('should export dotdo_buffer_size gauge', async () => {
      const ws = new MockWebSocket()

      // Create data to fill buffer
      for (let i = 0; i < 10; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_buffer_size gauge')
      expect(text).toContain('dotdo_buffer_size')

      const metrics = parsePrometheusText(text)
      const bufferMetric = metrics.get('dotdo_buffer_size')
      expect(bufferMetric).toBeDefined()
      expect(bufferMetric!.type).toBe('gauge')
    })

    it('should include buffer_type label', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should differentiate buffer types
      expect(text).toMatch(/buffer_type="pipeline"|buffer_type="checkpoint"/)
    })
  })

  describe('dirty_count Gauge', () => {
    it('should export dotdo_dirty_entries_count gauge', async () => {
      const ws = new MockWebSocket()

      // Create dirty entries (not checkpointed)
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_dirty_entries_count gauge')
      expect(text).toContain('dotdo_dirty_entries_count')

      const metrics = parsePrometheusText(text)
      const dirtyMetric = metrics.get('dotdo_dirty_entries_count')
      expect(dirtyMetric).toBeDefined()
      expect(dirtyMetric!.value).toBeGreaterThanOrEqual(5)
    })

    it('should decrease after checkpoint', async () => {
      const ws = new MockWebSocket()

      // Create dirty entries
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      // Get dirty count before checkpoint
      let response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
      let text = await response.text()
      let metrics = parsePrometheusText(text)
      const dirtyBefore = metrics.get('dotdo_dirty_entries_count')?.value ?? 0

      // Checkpoint
      await unifiedDO.checkpoint?.('manual')

      // Get dirty count after checkpoint
      response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
      text = await response.text()
      metrics = parsePrometheusText(text)
      const dirtyAfter = metrics.get('dotdo_dirty_entries_count')?.value ?? 0

      expect(dirtyAfter).toBeLessThan(dirtyBefore)
    })
  })

  describe('entries_count Gauge', () => {
    it('should export dotdo_entries_count gauge', async () => {
      const ws = new MockWebSocket()

      // Create entries
      for (let i = 0; i < 15; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_entries_count gauge')
      expect(text).toContain('dotdo_entries_count')

      const metrics = parsePrometheusText(text)
      const entriesMetric = metrics.get('dotdo_entries_count')
      expect(entriesMetric).toBeDefined()
      expect(entriesMetric!.value).toBe(15)
    })
  })

  describe('entries_bytes Gauge', () => {
    it('should export dotdo_entries_bytes gauge', async () => {
      const ws = new MockWebSocket()

      // Create entries with known sizes
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'TestEntity',
          data: { largeField: 'x'.repeat(1000) },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_entries_bytes gauge')
      expect(text).toContain('dotdo_entries_bytes')

      const metrics = parsePrometheusText(text)
      const bytesMetric = metrics.get('dotdo_entries_bytes')
      expect(bytesMetric).toBeDefined()
      expect(bytesMetric!.value).toBeGreaterThan(0)
    })
  })

  describe('replication_lag Gauge', () => {
    it('should export dotdo_replication_lag_seconds gauge', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_replication_lag_seconds gauge')
      expect(text).toContain('dotdo_replication_lag_seconds')
    })
  })

  describe('cache_hit_ratio Gauge', () => {
    it('should export dotdo_cache_hit_ratio gauge', async () => {
      const ws = new MockWebSocket()

      // Create and read to generate cache activity
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Multiple reads (should be cache hits)
      for (let i = 0; i < 10; i++) {
        await unifiedDO.get(ack!.$id)
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('# TYPE dotdo_cache_hit_ratio gauge')
      expect(text).toContain('dotdo_cache_hit_ratio')

      const metrics = parsePrometheusText(text)
      const hitRatioMetric = metrics.get('dotdo_cache_hit_ratio')
      expect(hitRatioMetric).toBeDefined()
      expect(hitRatioMetric!.value).toBeGreaterThanOrEqual(0)
      expect(hitRatioMetric!.value).toBeLessThanOrEqual(1)
    })
  })
})

// ============================================================================
// Label Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Metric Labels', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    mockState = createMockDOState('tenant-123')
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  describe('namespace Label', () => {
    it('should include namespace label derived from DO name', async () => {
      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should include the DO namespace
      expect(text).toContain('namespace="tenant-123"')
    })
  })

  describe('operation_type Label', () => {
    it('should include operation_type label with valid values', async () => {
      const ws = new MockWebSocket()

      // Create
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'TestEntity',
        data: { name: 'test' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Read
      await unifiedDO.get(ack!.$id)

      // Update
      await unifiedDO.handleUpdate(ws as unknown as WebSocket, {
        type: 'update',
        id: 'op-2',
        $id: ack!.$id,
        data: { name: 'updated' },
      })

      // Delete
      await unifiedDO.handleDelete(ws as unknown as WebSocket, {
        type: 'delete',
        id: 'op-3',
        $id: ack!.$id,
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should have all operation types
      expect(text).toContain('operation_type="create"')
      expect(text).toContain('operation_type="read"')
      expect(text).toContain('operation_type="update"')
      expect(text).toContain('operation_type="delete"')
    })
  })

  describe('entity_type Label', () => {
    it('should include entity_type label', async () => {
      const ws = new MockWebSocket()

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
        $type: 'Product',
        data: { sku: 'ABC' },
      })

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      expect(text).toContain('entity_type="Customer"')
      expect(text).toContain('entity_type="Order"')
      expect(text).toContain('entity_type="Product"')
    })
  })

  describe('Label cardinality limits', () => {
    it('should limit high-cardinality labels', async () => {
      const ws = new MockWebSocket()

      // Create many different entity types (high cardinality)
      for (let i = 0; i < 100; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: `UniqueType${i}`,
          data: { index: i },
        })
      }

      const request = new Request('https://test.api.dotdo.dev/metrics')
      const response = await unifiedDO.fetch(request)
      const text = await response.text()

      // Should either aggregate or limit high cardinality
      // Count unique entity_type labels
      const entityTypeMatches = text.match(/entity_type="[^"]+"/g) ?? []
      const uniqueEntityTypes = new Set(entityTypeMatches)

      // Should be limited to reasonable cardinality (e.g., top N or aggregated)
      expect(uniqueEntityTypes.size).toBeLessThanOrEqual(50)
    })
  })
})

// ============================================================================
// Hibernation Survival Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Metrics Hibernation Survival', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should persist metrics across hibernation', async () => {
    // Phase 1: Generate metrics
    let unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    const ws = new MockWebSocket()

    for (let i = 0; i < 20; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `op-${i}`,
        $type: 'TestEntity',
        data: { index: i },
      })
    }

    // Get metrics before hibernation
    let response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
    let text = await response.text()
    let metricsBefore = parsePrometheusText(text)
    const writesBefore = metricsBefore.get('dotdo_writes_total')?.value ?? 0

    // Hibernate
    await unifiedDO.beforeHibernation?.()

    // Phase 2: Simulate DO restart (new instance)
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    await unifiedDO.onStart?.()

    // Get metrics after wake
    response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
    text = await response.text()
    const metricsAfter = parsePrometheusText(text)
    const writesAfter = metricsAfter.get('dotdo_writes_total')?.value ?? 0

    // Counters should be preserved (or at least not reset to 0)
    expect(writesAfter).toBeGreaterThanOrEqual(writesBefore)
  })

  it('should preserve histogram data across hibernation', async () => {
    let unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    const ws = new MockWebSocket()

    // Generate histogram data
    for (let i = 0; i < 50; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `op-${i}`,
        $type: 'TestEntity',
        data: { index: i },
      })
    }

    let response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
    let text = await response.text()
    let metricsBefore = parsePrometheusText(text)
    const countBefore = metricsBefore.get('dotdo_operation_duration_seconds')?.count ?? 0

    // Hibernate and wake
    await unifiedDO.beforeHibernation?.()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    await unifiedDO.onStart?.()

    response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
    text = await response.text()
    const metricsAfter = parsePrometheusText(text)
    const countAfter = metricsAfter.get('dotdo_operation_duration_seconds')?.count ?? 0

    // Histogram count should be preserved
    expect(countAfter).toBeGreaterThanOrEqual(countBefore)
  })

  it('should accurately reflect gauge values after wake', async () => {
    let unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    const ws = new MockWebSocket()

    // Create entries
    for (let i = 0; i < 10; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `op-${i}`,
        $type: 'TestEntity',
        data: { index: i },
      })
    }

    // Checkpoint to persist
    await unifiedDO.checkpoint?.('manual')

    // Hibernate and wake
    await unifiedDO.beforeHibernation?.()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
    await unifiedDO.onStart?.()

    const response = await unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    // Gauge should reflect recovered state
    const entriesCount = metrics.get('dotdo_entries_count')?.value ?? 0
    expect(entriesCount).toBe(10)
  })
})

// ============================================================================
// Naming Convention Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Naming Conventions', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('should use snake_case for all metric names', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    for (const [name] of metrics) {
      // Should be snake_case (no camelCase, no dashes)
      expect(name).not.toMatch(/[A-Z]/)
      expect(name).not.toMatch(/-/)
      expect(isValidPrometheusName(name)).toBe(true)
    }
  })

  it('should prefix all metrics with dotdo_', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    for (const [name] of metrics) {
      expect(name.startsWith('dotdo_')).toBe(true)
    }
  })

  it('should use appropriate unit suffixes', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    // Check specific metrics for correct suffixes
    const expectedSuffixes: Record<string, string> = {
      'dotdo_operation_duration_seconds': '_seconds',
      'dotdo_checkpoint_duration_seconds': '_seconds',
      'dotdo_recovery_duration_seconds': '_seconds',
      'dotdo_replication_lag_seconds': '_seconds',
      'dotdo_entries_bytes': '_bytes',
      'dotdo_writes_total': '_total',
      'dotdo_reads_total': '_total',
      'dotdo_events_emitted_total': '_total',
      'dotdo_checkpoints_total': '_total',
    }

    for (const [metricName, suffix] of Object.entries(expectedSuffixes)) {
      if (metrics.has(metricName.replace(suffix, ''))) {
        expect(metricName.endsWith(suffix)).toBe(true)
      }
    }
  })

  it('should use _total suffix for counters', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    for (const [name, metric] of metrics) {
      if (metric.type === 'counter') {
        expect(name.endsWith('_total')).toBe(true)
      }
    }
  })

  it('should use base units (seconds not milliseconds, bytes not kilobytes)', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()

    // Should NOT use non-base units
    expect(text).not.toContain('_milliseconds')
    expect(text).not.toContain('_ms')
    expect(text).not.toContain('_kilobytes')
    expect(text).not.toContain('_kb')
    expect(text).not.toContain('_megabytes')
    expect(text).not.toContain('_mb')
  })
})

// ============================================================================
// Help Text Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Help Text', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  it('should include HELP line for every metric', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    for (const [name, metric] of metrics) {
      expect(metric.help).toBeDefined()
      expect(metric.help.length).toBeGreaterThan(0)
      expect(text).toContain(`# HELP ${name}`)
    }
  })

  it('should include TYPE line for every metric', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    for (const [name, metric] of metrics) {
      expect(metric.type).toBeDefined()
      expect(['counter', 'gauge', 'histogram', 'summary']).toContain(metric.type)
      expect(text).toContain(`# TYPE ${name}`)
    }
  })

  it('should have descriptive help text', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const metrics = parsePrometheusText(text)

    const expectedHelp: Record<string, string[]> = {
      'dotdo_writes_total': ['write', 'total', 'operation'],
      'dotdo_reads_total': ['read', 'total', 'operation'],
      'dotdo_events_emitted_total': ['event', 'emitted', 'pipeline'],
      'dotdo_checkpoints_total': ['checkpoint', 'SQLite', 'persist'],
      'dotdo_operation_duration_seconds': ['duration', 'latency', 'operation'],
      'dotdo_dirty_entries_count': ['dirty', 'pending', 'checkpoint'],
      'dotdo_entries_count': ['entries', 'memory', 'state'],
      'dotdo_buffer_size': ['buffer', 'pending', 'flush'],
    }

    for (const [metricBase, keywords] of Object.entries(expectedHelp)) {
      const metric = metrics.get(metricBase)
      if (metric) {
        const helpLower = metric.help.toLowerCase()
        // At least one keyword should be present
        const hasKeyword = keywords.some(kw => helpLower.includes(kw.toLowerCase()))
        expect(hasKeyword).toBe(true)
      }
    }
  })

  it('should place HELP before TYPE in output', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()

    // For each metric, HELP should come before TYPE
    const helpPattern = /# HELP (\w+)/g
    const typePattern = /# TYPE (\w+)/g

    const helpMatches = [...text.matchAll(helpPattern)]
    const typeMatches = [...text.matchAll(typePattern)]

    for (const helpMatch of helpMatches) {
      const metricName = helpMatch[1]
      const helpIndex = helpMatch.index!
      const typeMatch = typeMatches.find(tm => tm[1] === metricName)

      if (typeMatch) {
        expect(helpIndex).toBeLessThan(typeMatch.index!)
      }
    }
  })
})

// ============================================================================
// Integration Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Prometheus Metrics Integration', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should be scrapeable by Prometheus', async () => {
    const ws = new MockWebSocket()

    // Generate some activity
    for (let i = 0; i < 10; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `op-${i}`,
        $type: 'TestEntity',
        data: { index: i },
      })
    }

    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)

    // Should be successful
    expect(response.status).toBe(200)

    // Should have correct content type
    expect(response.headers.get('Content-Type')).toContain('text/plain')

    // Should be parseable
    const text = await response.text()
    const metrics = parsePrometheusText(text)
    expect(metrics.size).toBeGreaterThan(0)

    // All metrics should be valid
    for (const [name, metric] of metrics) {
      expect(isValidPrometheusName(name)).toBe(true)
      expect(metric.type).toBeDefined()
      expect(metric.help).toBeDefined()
    }
  })

  it('should expose process metrics', async () => {
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()

    // Should include standard process metrics
    expect(text).toContain('dotdo_info')
  })

  it('should work with existing MetricsCollector', async () => {
    const ws = new MockWebSocket()

    // The /metrics endpoint should use the existing MetricsCollector
    // and expose its data in Prometheus format

    for (let i = 0; i < 5; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `op-${i}`,
        $type: 'TestEntity',
        data: { index: i },
      })
    }

    // Get the internal metrics snapshot
    const internalSnapshot = (unifiedDO as unknown as { metrics: { snapshot: () => MetricsSnapshot } })
      .metrics?.snapshot()

    // Get Prometheus metrics
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()
    const prometheusMetrics = parsePrometheusText(text)

    // Values should be consistent
    if (internalSnapshot) {
      const entriesCountMetric = prometheusMetrics.get('dotdo_entries_count')
      if (entriesCountMetric) {
        expect(entriesCountMetric.value).toBe(internalSnapshot.state.entries.count)
      }
    }
  })

  it('should handle concurrent /metrics requests', async () => {
    const ws = new MockWebSocket()

    // Create some data
    for (let i = 0; i < 10; i++) {
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: `op-${i}`,
        $type: 'TestEntity',
        data: { index: i },
      })
    }

    // Make concurrent requests
    const requests = Array(10).fill(null).map(() =>
      unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))
    )

    const responses = await Promise.all(requests)

    // All should succeed
    for (const response of responses) {
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toContain('# TYPE')
    }
  })

  it('should not block other operations while scraping', async () => {
    const ws = new MockWebSocket()

    // Start a metrics scrape
    const metricsPromise = unifiedDO.fetch(new Request('https://test.api.dotdo.dev/metrics'))

    // Concurrent write operations should not block
    const writePromise = unifiedDO.handleCreate(ws as unknown as WebSocket, {
      type: 'create',
      id: 'concurrent-op',
      $type: 'TestEntity',
      data: { concurrent: true },
    })

    // Both should complete
    const [metricsResponse, _] = await Promise.all([metricsPromise, writePromise])

    expect(metricsResponse.status).toBe(200)
    const ack = ws.getLastMessage<{ status: string }>()
    expect(ack?.status).toBe('ack')
  })
})
