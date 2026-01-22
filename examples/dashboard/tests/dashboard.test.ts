/**
 * Dashboard App Tests
 *
 * Tests the operator dashboard using real miniflare instances with NO MOCKS.
 * All tests use actual DashboardDO instances via @cloudflare/vitest-pool-workers.
 *
 * @module apps/dashboard/tests/dashboard.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// Import the worker app for fetch testing
import app from '../src/index'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: 'healthy' | 'degraded'
  timestamp: string
  dos: {
    active: number
    inactive: number
    total: number
  }
  metrics: {
    totalRequests: number
    totalErrors: number
    errorRate: string
  }
  events: {
    lastHour: number
    failed: number
  }
}

interface DORegistration {
  id: string
  name: string
  className: string
  namespace: string
  registeredAt: number
  lastSeen: number
  status: 'active' | 'inactive' | 'unknown'
  metadata?: Record<string, unknown>
}

interface DOListResponse {
  dos: DORegistration[]
  total: number
}

interface DOEvent {
  id: string
  doId: string
  doName: string
  type: string
  payload?: unknown
  status: 'pending' | 'completed' | 'failed'
  timestamp: number
  duration?: number
  error?: string
}

interface EventListResponse {
  events: DOEvent[]
  total: number
}

interface MetricsResponse {
  totalRequests: number
  totalErrors: number
  errorRate: number
  activeDOs: number
}

interface TimeseriesResponse {
  timeseries: Array<{
    timestamp: number
    requests: number
    errors: number
    avgResponseTime: number
  }>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a test request with proper bindings
 */
function createTestRequest(path: string, options?: RequestInit): Request {
  return new Request(`https://dashboard.dotdo.dev${path}`, options)
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Dashboard App', () => {
  describe('UI Routes', () => {
    it('serves dashboard HTML at root path', async () => {
      const request = createTestRequest('/')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')

      const html = await response.text()
      expect(html).toContain('dotdo Operator Dashboard')
      expect(html).toContain('Active DOs')
      expect(html).toContain('Total Requests')
      expect(html).toContain('Error Rate')
    })
  })

  describe('Health API', () => {
    it('returns health status from DashboardDO', async () => {
      const request = createTestRequest('/api/health')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('healthy')
      expect(json.timestamp).toBeDefined()
      expect(json.dos).toBeDefined()
      expect(json.dos.active).toBeGreaterThanOrEqual(0)
      expect(json.dos.inactive).toBeGreaterThanOrEqual(0)
      expect(json.metrics).toBeDefined()
      expect(json.events).toBeDefined()
    })
  })

  describe('DO Registration API', () => {
    it('registers a new DO', async () => {
      const testId = generateTestId()
      const doData = {
        id: `do-${testId}`,
        name: `TestDO-${testId}`,
        className: 'TestClass',
        namespace: 'test-namespace',
        metadata: { version: '1.0' },
      }

      const request = createTestRequest('/api/dos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doData),
      })
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as { success: boolean; id: string }
      expect(json.success).toBe(true)
      expect(json.id).toBe(doData.id)
    })

    it('lists registered DOs', async () => {
      // First register a DO
      const testId = generateTestId()
      const doData = {
        id: `list-test-${testId}`,
        name: `ListTest-${testId}`,
        className: 'ListClass',
        namespace: 'list-namespace',
      }

      await app.fetch(
        createTestRequest('/api/dos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doData),
        }),
        env,
        {} as ExecutionContext
      )

      // Then list DOs
      const request = createTestRequest('/api/dos')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as DOListResponse
      expect(json.dos).toBeInstanceOf(Array)
      expect(json.total).toBeGreaterThanOrEqual(1)
    })

    it('gets single DO details', async () => {
      // First register a DO
      const testId = generateTestId()
      const doData = {
        id: `detail-test-${testId}`,
        name: `DetailTest-${testId}`,
        className: 'DetailClass',
        namespace: 'detail-namespace',
      }

      await app.fetch(
        createTestRequest('/api/dos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doData),
        }),
        env,
        {} as ExecutionContext
      )

      // Get details
      const request = createTestRequest(`/api/dos/${doData.id}`)
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as {
        registration: DORegistration
        metrics: unknown
        recentEvents: DOEvent[]
      }
      expect(json.registration.id).toBe(doData.id)
      expect(json.registration.name).toBe(doData.name)
      expect(json.registration.className).toBe(doData.className)
      expect(json.registration.status).toBe('active')
    })

    it('returns 404 for non-existent DO', async () => {
      const request = createTestRequest('/api/dos/non-existent-do-id')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(404)
    })

    it('updates DO heartbeat', async () => {
      // First register a DO
      const testId = generateTestId()
      const doData = {
        id: `heartbeat-test-${testId}`,
        name: `HeartbeatTest-${testId}`,
        className: 'HeartbeatClass',
        namespace: 'heartbeat-namespace',
      }

      await app.fetch(
        createTestRequest('/api/dos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doData),
        }),
        env,
        {} as ExecutionContext
      )

      // Wait a small amount
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Send heartbeat
      const request = createTestRequest(`/api/dos/${doData.id}/heartbeat`, {
        method: 'POST',
      })
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as { success: boolean }
      expect(json.success).toBe(true)
    })
  })

  describe('Events API', () => {
    it('records a new event', async () => {
      const testId = generateTestId()
      const eventData = {
        doId: `event-do-${testId}`,
        doName: `EventDO-${testId}`,
        type: 'test.event',
        payload: { key: 'value' },
        status: 'completed' as const,
        duration: 100,
      }

      const request = createTestRequest('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      })
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as { success: boolean; id: string }
      expect(json.success).toBe(true)
      expect(json.id).toBeDefined()
    })

    it('lists recent events', async () => {
      // First record an event
      const testId = generateTestId()
      const eventData = {
        doId: `list-event-do-${testId}`,
        doName: `ListEventDO-${testId}`,
        type: 'list.test',
        status: 'completed' as const,
      }

      await app.fetch(
        createTestRequest('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData),
        }),
        env,
        {} as ExecutionContext
      )

      // List events
      const request = createTestRequest('/api/events')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as EventListResponse
      expect(json.events).toBeInstanceOf(Array)
      expect(json.total).toBeGreaterThanOrEqual(1)
    })

    it('filters events by status', async () => {
      // Record a failed event
      const testId = generateTestId()
      const eventData = {
        doId: `filter-event-do-${testId}`,
        doName: `FilterEventDO-${testId}`,
        type: 'filter.test',
        status: 'failed' as const,
        error: 'Test error',
      }

      await app.fetch(
        createTestRequest('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData),
        }),
        env,
        {} as ExecutionContext
      )

      // List failed events
      const request = createTestRequest('/api/events?status=failed')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as EventListResponse
      expect(json.events).toBeInstanceOf(Array)
      // All returned events should be failed
      for (const event of json.events) {
        expect(event.status).toBe('failed')
      }
    })
  })

  describe('Metrics API', () => {
    it('records metrics', async () => {
      const testId = generateTestId()
      const metricsData = {
        doId: `metrics-do-${testId}`,
        requestCount: 10,
        errorCount: 1,
        responseTime: 50,
      }

      const request = createTestRequest('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metricsData),
      })
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as { success: boolean }
      expect(json.success).toBe(true)
    })

    it('gets aggregated metrics', async () => {
      const request = createTestRequest('/api/metrics')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as MetricsResponse
      expect(json.totalRequests).toBeGreaterThanOrEqual(0)
      expect(json.totalErrors).toBeGreaterThanOrEqual(0)
      expect(typeof json.errorRate).toBe('number')
      expect(json.activeDOs).toBeGreaterThanOrEqual(0)
    })

    it('gets metrics for specific DO', async () => {
      // First record metrics for a specific DO
      const testId = generateTestId()
      const doId = `specific-metrics-do-${testId}`
      const metricsData = {
        doId,
        requestCount: 5,
        errorCount: 0,
        responseTime: 30,
      }

      await app.fetch(
        createTestRequest('/api/metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metricsData),
        }),
        env,
        {} as ExecutionContext
      )

      // Get metrics for that DO
      const request = createTestRequest(`/api/metrics?doId=${doId}`)
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as {
        doId: string
        requestCount: number
        errorCount: number
        avgResponseTime: number
        lastUpdated: number
      }
      expect(json.doId).toBe(doId)
      expect(json.requestCount).toBe(5)
      expect(json.errorCount).toBe(0)
    })

    it('gets time-series metrics', async () => {
      const request = createTestRequest('/api/metrics/timeseries?hours=1')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as TimeseriesResponse
      expect(json.timeseries).toBeInstanceOf(Array)
    })
  })

  describe('Report API (Combined Endpoint)', () => {
    it('handles combined DO registration, metrics, and event reporting', async () => {
      const testId = generateTestId()
      const reportData = {
        do: {
          id: `report-do-${testId}`,
          name: `ReportDO-${testId}`,
          className: 'ReportClass',
          namespace: 'report-namespace',
        },
        metrics: {
          requestCount: 1,
          errorCount: 0,
          responseTime: 25,
        },
        event: {
          type: 'report.test',
          status: 'completed' as const,
          duration: 25,
        },
      }

      const request = createTestRequest('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      })
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as { success: boolean }
      expect(json.success).toBe(true)

      // Verify DO was registered
      const doResponse = await app.fetch(
        createTestRequest(`/api/dos/${reportData.do.id}`),
        env,
        {} as ExecutionContext
      )
      expect(doResponse.status).toBe(200)
    })
  })

  describe('Inspect API', () => {
    it('inspects a registered DO', async () => {
      // First register a DO with some activity
      const testId = generateTestId()
      const doId = `inspect-do-${testId}`

      await app.fetch(
        createTestRequest('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            do: {
              id: doId,
              name: `InspectDO-${testId}`,
              className: 'InspectClass',
              namespace: 'inspect-namespace',
              metadata: { version: '1.0', environment: 'test' },
            },
            metrics: { requestCount: 10, errorCount: 2, responseTime: 45 },
            event: { type: 'inspect.test', status: 'completed', duration: 45 },
          }),
        }),
        env,
        {} as ExecutionContext
      )

      // Inspect the DO
      const request = createTestRequest(`/api/inspect/${doId}`)
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(200)

      const json = (await response.json()) as {
        id: string
        registration: {
          name: string
          className: string
          namespace: string
          registeredAt: number
          lastSeen: number
          status: string
          metadata: Record<string, unknown> | null
        }
        metrics: {
          requestCount: number
          errorCount: number
          avgResponseTime: number
          errorRate: string
        } | null
        recentEvents: Array<{
          id: string
          type: string
          status: string
          timestamp: number
          duration: number | null
          error: string | null
        }>
        timeseries: Array<{
          timestamp: number
          requests: number
          errors: number
          avgResponseTime: number
        }>
      }

      expect(json.id).toBe(doId)
      expect(json.registration.name).toBe(`InspectDO-${testId}`)
      expect(json.registration.metadata).toEqual({ version: '1.0', environment: 'test' })
      expect(json.metrics).not.toBeNull()
      expect(json.metrics?.requestCount).toBe(10)
      expect(json.recentEvents).toBeInstanceOf(Array)
      expect(json.timeseries).toBeInstanceOf(Array)
    })

    it('returns 404 for non-existent DO inspection', async () => {
      const request = createTestRequest('/api/inspect/non-existent-inspect-do')
      const response = await app.fetch(request, env, {} as ExecutionContext)

      expect(response.status).toBe(404)
    })
  })

  describe('CORS', () => {
    it('includes CORS headers in responses', async () => {
      const request = createTestRequest('/api/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })
      const response = await app.fetch(request, env, {} as ExecutionContext)

      const corsHeader = response.headers.get('Access-Control-Allow-Origin')
      expect(corsHeader).toBeTruthy()
    })
  })
})

describe('DashboardDO Direct Tests', () => {
  /**
   * Tests DashboardDO directly via DO stub for comprehensive coverage
   */

  describe('DO Health Endpoint', () => {
    it('responds to root path with DO info', async () => {
      const id = env.DASHBOARD_DO.idFromName('direct-test-' + generateTestId())
      const stub = env.DASHBOARD_DO.get(id)

      const response = await stub.fetch('http://internal/')

      expect(response.status).toBe(200)

      const json = (await response.json()) as {
        status: string
        service: string
        id: string
        timestamp: string
      }
      expect(json.status).toBe('ok')
      expect(json.service).toBe('dashboard-do')
      expect(json.id).toBeDefined()
      expect(json.timestamp).toBeDefined()
    })
  })

  describe('DO Storage Operations', () => {
    it('persists DO registration across requests', async () => {
      const testId = generateTestId()
      const id = env.DASHBOARD_DO.idFromName('persist-test-' + testId)
      const stub = env.DASHBOARD_DO.get(id)

      // Register a DO
      const doData = {
        id: `persist-do-${testId}`,
        name: `PersistDO-${testId}`,
        className: 'PersistClass',
        namespace: 'persist-namespace',
      }

      await stub.fetch('http://internal/dos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doData),
      })

      // Fetch it back in a new request
      const response = await stub.fetch(`http://internal/dos/${doData.id}`)

      expect(response.status).toBe(200)

      const json = (await response.json()) as { registration: DORegistration }
      expect(json.registration.id).toBe(doData.id)
      expect(json.registration.name).toBe(doData.name)
    })
  })

  describe('Concurrent DO Access', () => {
    it('handles concurrent requests correctly', async () => {
      const testId = generateTestId()
      const id = env.DASHBOARD_DO.idFromName('concurrent-' + testId)
      const stub = env.DASHBOARD_DO.get(id)

      // Fire multiple concurrent requests
      const requests = Array.from({ length: 5 }, (_, i) =>
        stub.fetch('http://internal/dos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `concurrent-do-${testId}-${i}`,
            name: `ConcurrentDO-${testId}-${i}`,
            className: 'ConcurrentClass',
            namespace: 'concurrent-namespace',
          }),
        })
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        const json = (await response.json()) as { success: boolean }
        expect(json.success).toBe(true)
      }

      // Verify all were registered
      const listResponse = await stub.fetch('http://internal/dos?limit=100')
      const listJson = (await listResponse.json()) as DOListResponse
      expect(listJson.total).toBeGreaterThanOrEqual(5)
    })
  })
})
