/**
 * Tests for DO Metrics Collection Integration
 *
 * Verifies that the DO class properly integrates with the observability
 * package to collect metrics for:
 * - Request count and latency
 * - Storage operations
 * - RPC calls
 * - WebSocket connections
 * - Alarm executions
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DO, type DOOptions, type DOMetricsConfig } from '../DO'

// Mock DurableObjectState for testing
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'test-do-id-12345',
      equals: (other) => other.toString() === 'test-do-id-12345',
      name: 'test-do',
    },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => { storage.set(key, value) },
      delete: async (key: string) => storage.delete(key),
      deleteAll: async () => { storage.clear() },
      list: async () => new Map(storage),
      getAlarm: async () => null,
      setAlarm: async () => {},
      deleteAlarm: async () => {},
      sync: async () => {},
      transaction: async (fn: () => Promise<void>) => { await fn() },
      transactionSync: (fn: () => void) => { fn() },
      sql: {
        exec: () => ({ changes: 0, duration: 0, lastRowId: 0, columnsCount: 0, rowsCount: 0 }),
        databaseSize: 0,
      },
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => { await fn() },
    waitUntil: () => {},
    abort: () => {},
    acceptWebSocket: () => {},
    getWebSockets: () => [],
  } as unknown as DurableObjectState
}

// Mock DOEnv
const mockEnv = {}

describe('DO Metrics Integration', () => {
  describe('metrics configuration', () => {
    it('should not enable metrics by default', () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv)

      // Metrics should be undefined when not enabled
      const metrics = doInstance.getMetrics()
      expect(metrics).toBeUndefined()
    })

    it('should enable metrics with boolean true', () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      // Metrics should be available when enabled
      const metrics = doInstance.getMetrics()
      expect(metrics).toBeDefined()
      expect(Array.isArray(metrics)).toBe(true)
    })

    it('should enable metrics with config object', () => {
      const state = createMockState()
      const config: DOMetricsConfig = {
        enabled: true,
        serviceName: 'custom-do-service',
        enableTracing: false,
        enableLogging: false,
      }
      const doInstance = new DO(state, mockEnv, { metrics: config })

      const metrics = doInstance.getMetrics()
      expect(metrics).toBeDefined()
    })

    it('should not enable metrics when config.enabled is false', () => {
      const state = createMockState()
      const config: DOMetricsConfig = {
        enabled: false,
      }
      const doInstance = new DO(state, mockEnv, { metrics: config })

      const metrics = doInstance.getMetrics()
      expect(metrics).toBeUndefined()
    })
  })

  describe('request metrics', () => {
    it('should track fetch request count', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      // Make a request
      const request = new Request('https://test.do/')
      await doInstance.fetch(request)

      // Check metrics
      const metrics = doInstance.getMetrics()
      expect(metrics).toBeDefined()

      // Should have request count metric
      const requestCountMetric = metrics?.find(m => m.name === 'rpc.request.count')
      expect(requestCountMetric).toBeDefined()
    })

    it('should track fetch request duration', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      // Make a request
      const request = new Request('https://test.do/')
      await doInstance.fetch(request)

      // Check metrics
      const metrics = doInstance.getMetrics()

      // Should have request duration metric
      const durationMetric = metrics?.find(m => m.name === 'do.request.duration')
      expect(durationMetric).toBeDefined()
    })

    it('should add correlation ID header to response', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      const request = new Request('https://test.do/')
      const response = await doInstance.fetch(request)

      // Should have correlation ID
      const correlationId = response.headers.get('X-Correlation-ID')
      expect(correlationId).toBeDefined()
      expect(correlationId!.length).toBeGreaterThan(0)
    })

    it('should preserve incoming correlation ID', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      const incomingCorrelationId = 'incoming-correlation-123'
      const request = new Request('https://test.do/', {
        headers: {
          'x-correlation-id': incomingCorrelationId,
        },
      })
      const response = await doInstance.fetch(request)

      // Should preserve the incoming correlation ID
      const correlationId = response.headers.get('X-Correlation-ID')
      expect(correlationId).toBe(incomingCorrelationId)
    })
  })

  describe('storage operation tracking', () => {
    it('should allow tracking storage operations', () => {
      const state = createMockState()

      // Create a subclass to access protected method
      class TestDO extends DO {
        public testTrackStorage(op: string, attrs?: Record<string, string | number | boolean>) {
          this.trackStorageOperation(op, attrs)
        }
      }

      const doInstance = new TestDO(state, mockEnv, { metrics: true })

      // Track storage operations
      doInstance.testTrackStorage('get', { key: 'users/123' })
      doInstance.testTrackStorage('put', { key: 'users/456' })
      doInstance.testTrackStorage('delete', { key: 'users/789' })

      // Check metrics
      const metrics = doInstance.getMetrics()

      // Should have storage operation metrics
      const storageMetrics = metrics?.filter(m => m.name === 'do.storage.operations')
      expect(storageMetrics).toBeDefined()
      expect(storageMetrics!.length).toBeGreaterThan(0)
    })

    it('should not error when tracking storage without metrics enabled', () => {
      const state = createMockState()

      class TestDO extends DO {
        public testTrackStorage(op: string, attrs?: Record<string, string | number | boolean>) {
          this.trackStorageOperation(op, attrs)
        }
      }

      const doInstance = new TestDO(state, mockEnv) // No metrics

      // Should not throw
      expect(() => {
        doInstance.testTrackStorage('get', { key: 'test' })
      }).not.toThrow()
    })
  })

  describe('WebSocket connection tracking', () => {
    it('should allow tracking WebSocket connections', () => {
      const state = createMockState()

      class TestDO extends DO {
        public testTrackConnection() {
          this.trackWebSocketConnection()
        }
      }

      const doInstance = new TestDO(state, mockEnv, { metrics: true })

      // Track connections
      doInstance.testTrackConnection()
      doInstance.testTrackConnection()

      // Check metrics
      const metrics = doInstance.getMetrics()

      // Should have WebSocket connection metric
      const wsMetric = metrics?.find(m => m.name === 'do.websocket.connections')
      expect(wsMetric).toBeDefined()
      expect(wsMetric!.value).toBe(2)
    })

    it('should track WebSocket close as disconnection', async () => {
      const state = createMockState()

      class TestDO extends DO {
        public testTrackConnection() {
          this.trackWebSocketConnection()
        }
      }

      const doInstance = new TestDO(state, mockEnv, { metrics: true })

      // Simulate connect and disconnect
      doInstance.testTrackConnection() // +1
      doInstance.testTrackConnection() // +1

      // Simulate close - mock WebSocket
      const mockWs = {} as WebSocket
      await doInstance.webSocketClose(mockWs, 1000, 'Normal closure', true) // -1

      // Check metrics
      const metrics = doInstance.getMetrics()
      const wsMetric = metrics?.find(m => m.name === 'do.websocket.connections')
      expect(wsMetric).toBeDefined()
      expect(wsMetric!.value).toBe(1)
    })
  })

  describe('alarm execution tracking', () => {
    it('should track alarm executions', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      // Trigger alarm
      await doInstance.alarm()

      // Check metrics
      const metrics = doInstance.getMetrics()

      // Should have alarm execution metric
      const alarmMetric = metrics?.find(m => m.name === 'do.alarm.executions')
      expect(alarmMetric).toBeDefined()
    })
  })

  describe('error tracking', () => {
    it('should return 500 for unhandled route errors', async () => {
      const state = createMockState()

      // Create a DO that throws on a specific route
      class ErrorDO extends DO {
        constructor(state: DurableObjectState, env: unknown, options?: DOOptions) {
          super(state, env, options)
        }

        protected routes(app: ReturnType<typeof import('hono').Hono>) {
          app.get('/error', () => {
            throw new Error('Test error')
          })
        }
      }

      const doInstance = new ErrorDO(state, mockEnv, { metrics: true })

      // Make a request to the error route
      const request = new Request('https://test.do/error')
      const response = await doInstance.fetch(request)

      // Should get 500 response - Hono catches the error internally
      expect(response.status).toBe(500)

      // Request count metric should still be recorded
      const metrics = doInstance.getMetrics()
      const requestMetric = metrics?.find(m => m.name === 'rpc.request.count')
      expect(requestMetric).toBeDefined()
    })

    it('should track request duration even when response is error status', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      // Make a request to non-existent route
      const request = new Request('https://test.do/nonexistent')
      const response = await doInstance.fetch(request)

      // Should get 404 response
      expect(response.status).toBe(404)

      // Duration metric should still be recorded
      const metrics = doInstance.getMetrics()
      const durationMetric = metrics?.find(m => m.name === 'do.request.duration')
      expect(durationMetric).toBeDefined()
    })
  })

  describe('trace context propagation', () => {
    it('should extract trace context from incoming request', async () => {
      const state = createMockState()
      const doInstance = new DO(state, mockEnv, { metrics: true })

      const traceId = 'abcdef1234567890abcdef1234567890'
      const spanId = '1234567890abcdef'
      const request = new Request('https://test.do/', {
        headers: {
          'traceparent': `00-${traceId}-${spanId}-01`,
        },
      })

      await doInstance.fetch(request)

      // The request should have been processed with trace context
      // (internal implementation detail, but we verify no errors occurred)
      const metrics = doInstance.getMetrics()
      expect(metrics).toBeDefined()
    })
  })
})
