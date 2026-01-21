/**
 * Tests for Graceful Degradation Module
 *
 * @module @dotdo/do/tests/graceful-degradation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HealthChecker,
  FallbackHandler,
  GracefulDegradationHandler,
  createHealthChecker,
  createFallbackHandler,
  createGracefulDegradationHandler,
  createWriteQueue,
  createEnhancedGracefulDegradationHandler,
  addDegradationHeaders,
  parseDegradationHeaders,
  type HealthStatus,
  type FallbackContext,
  type WriteQueue,
  type DegradationStatus,
  type EnhancedGracefulDegradationHandler,
} from '../graceful-degradation'

describe('HealthChecker', () => {
  let checker: HealthChecker

  beforeEach(() => {
    checker = createHealthChecker({
      timeoutMs: 100,
      degradedLatencyMs: 50,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
    })
  })

  describe('health checks', () => {
    it('should check health with custom function', async () => {
      const result = await checker.check('test-service', async () => ({
        healthy: true,
        latencyMs: 10,
      }))

      expect(result.name).toBe('test-service')
      expect(result.status).toBe('healthy')
      expect(result.latencyMs).toBe(10)
    })

    it('should mark as degraded with high latency', async () => {
      const result = await checker.check('slow-service', async () => ({
        healthy: true,
        latencyMs: 100, // Higher than degradedLatencyMs (50)
      }))

      expect(result.status).toBe('degraded')
    })

    it('should mark as unhealthy on failure', async () => {
      // Fail multiple times to reach unhealthy threshold
      for (let i = 0; i < 3; i++) {
        await checker.check('failing-service', async () => ({
          healthy: false,
          latencyMs: 10,
          error: 'Service down',
        }))
      }

      const result = checker.getStatus('failing-service')
      expect(result?.status).toBe('unhealthy')
    })

    it('should handle timeout', async () => {
      const result = await checker.check('timeout-service', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return { healthy: true, latencyMs: 0 }
      })

      // Timeout results in failure, which shows as degraded or unhealthy depending on history
      expect(['degraded', 'unhealthy']).toContain(result.status)
      expect(result.error).toContain('timeout')
    })
  })

  describe('health report', () => {
    it('should generate overall health report', async () => {
      await checker.check('healthy-1', async () => ({ healthy: true, latencyMs: 10 }))
      await checker.check('healthy-2', async () => ({ healthy: true, latencyMs: 15 }))

      const report = checker.getReport()

      expect(report.status).toBe('healthy')
      expect(report.healthyCount).toBe(2)
      expect(report.degradedCount).toBe(0)
      expect(report.unhealthyCount).toBe(0)
      expect(report.services).toHaveLength(2)
    })

    it('should mark overall as degraded when any service is degraded', async () => {
      await checker.check('healthy', async () => ({ healthy: true, latencyMs: 10 }))
      await checker.check('degraded', async () => ({ healthy: true, latencyMs: 100 }))

      const report = checker.getReport()
      expect(report.status).toBe('degraded')
    })

    it('should calculate uptime percentage', async () => {
      // All healthy checks
      for (let i = 0; i < 5; i++) {
        await checker.check('service', async () => ({ healthy: true, latencyMs: 10 }))
      }

      const report = checker.getReport()
      expect(report.uptimePercentage).toBe(100)
    })
  })

  describe('service management', () => {
    it('should register services', () => {
      checker.register('new-service')
      const status = checker.getStatus('new-service')
      expect(status?.status).toBe('unknown')
    })

    it('should unregister services', async () => {
      await checker.check('temp-service', async () => ({ healthy: true, latencyMs: 10 }))
      checker.unregister('temp-service')

      expect(checker.getStatus('temp-service')).toBeUndefined()
    })

    it('should clear all services', async () => {
      await checker.check('service-1', async () => ({ healthy: true, latencyMs: 10 }))
      await checker.check('service-2', async () => ({ healthy: true, latencyMs: 10 }))

      checker.clear()

      expect(checker.getReport().services).toHaveLength(0)
    })
  })
})

describe('FallbackHandler', () => {
  let handler: FallbackHandler

  beforeEach(() => {
    handler = createFallbackHandler({
      statusCode: 503,
      enableCache: true,
      cacheTtlMs: 1000,
    })
  })

  describe('fallback responses', () => {
    it('should generate default fallback response', async () => {
      const request = new Request('https://test.api.dotdo.dev/test')
      const context: FallbackContext = {
        namespace: 'test',
        error: new Error('Service unavailable'),
        circuitOpen: true,
        healthStatus: 'unhealthy',
      }

      const response = await handler.getFallback(request, context)

      expect(response.status).toBe(503)
      expect(response.headers.get('X-Fallback')).toBe('generated')

      const body = await response.json()
      expect(body.error).toBe('Service temporarily unavailable')
      expect(body.namespace).toBe('test')
    })

    it('should use cached response when available', async () => {
      const request = new Request('https://test.api.dotdo.dev/cached')
      const cachedResponse = new Response(JSON.stringify({ data: 'cached' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

      handler.cacheResponse('test', request.url, cachedResponse)

      const context: FallbackContext = {
        namespace: 'test',
        error: new Error('Service unavailable'),
        circuitOpen: true,
        healthStatus: 'unhealthy',
      }

      const response = await handler.getFallback(request, context)

      expect(response.status).toBe(200)
      expect(response.headers.get('X-Fallback')).toBe('cached')
    })

    it('should use custom response generator', async () => {
      const customHandler = createFallbackHandler({
        generateResponse: (_request, _error, context) => {
          return new Response(JSON.stringify({ custom: true, ns: context.namespace }), {
            status: 503,
          })
        },
      })

      const request = new Request('https://test.api.dotdo.dev/custom')
      const context: FallbackContext = {
        namespace: 'custom',
        error: new Error('fail'),
        circuitOpen: false,
        healthStatus: 'degraded',
      }

      const response = await customHandler.getFallback(request, context)
      const body = await response.json()

      expect(body.custom).toBe(true)
      expect(body.ns).toBe('custom')
    })
  })

  describe('response caching', () => {
    it('should cache responses', () => {
      const response = new Response('cached')
      handler.cacheResponse('ns', 'http://test.com/path', response)

      const cached = handler.getCachedResponse('ns', 'http://test.com/path')
      expect(cached).toBeDefined()
    })

    it('should return undefined for expired cache', async () => {
      const shortCacheHandler = createFallbackHandler({
        enableCache: true,
        cacheTtlMs: 50,
      })

      const response = new Response('cached')
      shortCacheHandler.cacheResponse('ns', 'http://test.com/path', response)

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 60))

      const cached = shortCacheHandler.getCachedResponse('ns', 'http://test.com/path')
      expect(cached).toBeUndefined()
    })

    it('should clear cache', () => {
      const response = new Response('cached')
      handler.cacheResponse('ns', 'http://test.com/path', response)
      handler.clearCache()

      const cached = handler.getCachedResponse('ns', 'http://test.com/path')
      expect(cached).toBeUndefined()
    })

    it('should clear namespace-specific cache', () => {
      const response = new Response('cached')
      handler.cacheResponse('ns1', 'http://test.com/a', response)
      handler.cacheResponse('ns2', 'http://test.com/b', response)

      handler.clearNamespaceCache('ns1')

      expect(handler.getCachedResponse('ns1', 'http://test.com/a')).toBeUndefined()
      expect(handler.getCachedResponse('ns2', 'http://test.com/b')).toBeDefined()
    })
  })
})

describe('GracefulDegradationHandler', () => {
  let handler: GracefulDegradationHandler

  beforeEach(() => {
    handler = createGracefulDegradationHandler({
      circuitBreakerConfig: {
        failureThreshold: 2,
        resetTimeoutMs: 100,
        timeoutMs: 50,
      },
      healthCheckConfig: {
        timeoutMs: 50,
      },
      fallbackConfig: {
        enableCache: true,
      },
    })
  })

  describe('request execution', () => {
    it('should execute successful requests', async () => {
      const request = new Request('https://test.api.dotdo.dev/success')

      const response = await handler.executeRequest('test', request, async () => {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
    })

    it('should return fallback on failure', async () => {
      const request = new Request('https://test.api.dotdo.dev/fail')

      // Fail enough times to open circuit
      for (let i = 0; i < 3; i++) {
        await handler.executeRequest('failing', request, async () => {
          throw new Error('Service down')
        })
      }

      const response = await handler.executeRequest('failing', request, async () => {
        throw new Error('Should not reach here')
      })

      expect(response.status).toBe(503)
    })

    it('should cache successful responses', async () => {
      const request = new Request('https://test.api.dotdo.dev/cacheable')

      // First request - should be successful
      await handler.executeRequest('cacheable', request, async () => {
        return new Response(JSON.stringify({ cached: 'data' }), { status: 200 })
      })

      // Open circuit
      const circuit = handler.getCircuit('cacheable')
      circuit.forceOpen()

      // Second request - should use cached response
      const fallbackResponse = await handler.executeRequest('cacheable', request, async () => {
        throw new Error('Circuit open')
      })

      // Should get a fallback response
      expect(fallbackResponse.status).toBe(200) // Cached response
      expect(fallbackResponse.headers.get('X-Fallback')).toBe('cached')
    })
  })

  describe('health checks', () => {
    it('should perform health checks', async () => {
      const result = await handler.checkHealth('test-ns', async () => ({
        healthy: true,
        latencyMs: 10,
      }))

      expect(result.name).toBe('test-ns')
      expect(result.status).toBe('healthy')
      expect(result.circuitState).toBe('closed')
    })

    it('should include circuit state in health', async () => {
      const circuit = handler.getCircuit('test-circuit')
      circuit.forceOpen()

      const result = await handler.checkHealth('test-circuit', async () => ({
        healthy: true,
        latencyMs: 10,
      }))

      expect(result.circuitState).toBe('open')
    })
  })

  describe('health report', () => {
    it('should generate comprehensive health report', async () => {
      await handler.checkHealth('service-1', async () => ({ healthy: true, latencyMs: 10 }))
      await handler.checkHealth('service-2', async () => ({ healthy: true, latencyMs: 15 }))

      const report = handler.getHealthReport()

      expect(report.status).toBe('healthy')
      expect(report.services).toHaveLength(2)
    })
  })

  describe('circuit management', () => {
    it('should expose circuit for namespace', () => {
      const circuit = handler.getCircuit('my-namespace')
      expect(circuit.getName()).toBe('my-namespace')
    })

    it('should get all circuit stats', async () => {
      const circuit1 = handler.getCircuit('ns1')
      const circuit2 = handler.getCircuit('ns2')

      // Make some requests
      await circuit1.execute(async () => 'success')
      await circuit2.execute(async () => {
        throw new Error('fail')
      })

      const allStats = handler.getAllCircuitStats()

      expect(allStats['ns1'].successCount).toBe(1)
      expect(allStats['ns2'].failureCount).toBe(1)
    })
  })

  describe('reset', () => {
    it('should reset all state', async () => {
      // Create some state
      const circuit = handler.getCircuit('reset-test')
      circuit.forceOpen()
      await handler.checkHealth('reset-test', async () => ({ healthy: false, latencyMs: 0 }))

      handler.reset()

      // Verify reset
      const newCircuit = handler.getCircuit('reset-test')
      expect(newCircuit.getState()).toBe('closed')
      expect(handler.getHealthReport().services).toHaveLength(0)
    })
  })
})

describe('Integration scenarios', () => {
  it('should handle cascading failures gracefully', async () => {
    const handler = createGracefulDegradationHandler({
      circuitBreakerConfig: {
        failureThreshold: 2,
        resetTimeoutMs: 100,
      },
    })

    const request = new Request('https://cascade.api.dotdo.dev/test')
    let callCount = 0

    // Simulate cascading failures
    for (let i = 0; i < 5; i++) {
      await handler.executeRequest('cascade', request, async () => {
        callCount++
        throw new Error('Cascading failure')
      })
    }

    // After circuit opens, operation should not be called
    // Calls should be: 2 (threshold) + some rejected
    expect(callCount).toBeLessThanOrEqual(3) // Circuit should open after 2 failures
  })

  it('should recover after circuit reset timeout', async () => {
    const handler = createGracefulDegradationHandler({
      circuitBreakerConfig: {
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenRequestRatio: 1.0, // Always allow in half-open
        successThreshold: 1,
      },
    })

    const request = new Request('https://recover.api.dotdo.dev/test')

    // Fail to open circuit
    await handler.executeRequest('recover', request, async () => {
      throw new Error('Initial failure')
    })

    expect(handler.getCircuit('recover').getState()).toBe('open')

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Should be able to recover
    const response = await handler.executeRequest('recover', request, async () => {
      return new Response(JSON.stringify({ recovered: true }), { status: 200 })
    })

    expect(response.status).toBe(200)
    expect(handler.getCircuit('recover').getState()).toBe('closed')
  })
})

// ============================================================================
// WriteQueue Tests
// ============================================================================

describe('WriteQueue', () => {
  let queue: WriteQueue

  beforeEach(() => {
    queue = createWriteQueue({
      maxAttempts: 3,
      initialBackoff: 100,
      maxBackoff: 1000,
      maxQueueSize: 10,
    })
  })

  describe('enqueue', () => {
    it('should enqueue a write operation', async () => {
      const request = new Request('https://test.api.dotdo.dev/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice' }),
        headers: { 'Content-Type': 'application/json' },
      })

      const id = await queue.enqueue({
        namespace: 'test',
        operation: 'POST /customers',
        request,
      })

      expect(id).toBeDefined()
      expect(id.startsWith('wq-')).toBe(true)

      const write = queue.get(id)
      expect(write).not.toBeNull()
      expect(write?.namespace).toBe('test')
      expect(write?.operation).toBe('POST /customers')
      expect(write?.status).toBe('pending')
    })

    it('should respect max queue size', async () => {
      // Fill the queue
      for (let i = 0; i < 12; i++) {
        await queue.enqueue({
          namespace: 'test',
          operation: `op-${i}`,
          request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
        })
      }

      const stats = queue.getStats()
      // Should not exceed max size
      expect(stats.total).toBeLessThanOrEqual(10)
    })

    it('should set priority', async () => {
      await queue.enqueue({
        namespace: 'test',
        operation: 'low-priority',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
        priority: 1,
      })

      await queue.enqueue({
        namespace: 'test',
        operation: 'high-priority',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
        priority: 10,
      })

      const writes = queue.query({ sortBy: 'priority', sortOrder: 'desc' })
      expect(writes[0]?.operation).toBe('high-priority')
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      await queue.enqueue({
        namespace: 'ns1',
        operation: 'create',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })
      await queue.enqueue({
        namespace: 'ns2',
        operation: 'update',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'PUT' }),
      })
      await queue.enqueue({
        namespace: 'ns1',
        operation: 'delete',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'DELETE' }),
      })
    })

    it('should filter by namespace', () => {
      const writes = queue.query({ namespace: 'ns1' })
      expect(writes.length).toBe(2)
      expect(writes.every((w) => w.namespace === 'ns1')).toBe(true)
    })

    it('should filter by operation', () => {
      const writes = queue.query({ operation: 'create' })
      expect(writes.length).toBe(1)
      expect(writes[0]?.operation).toBe('create')
    })

    it('should filter by status', () => {
      const writes = queue.query({ status: 'pending' })
      expect(writes.length).toBe(3)
    })

    it('should limit results', () => {
      const writes = queue.query({ limit: 2 })
      expect(writes.length).toBe(2)
    })
  })

  describe('processing', () => {
    it('should process a write successfully', async () => {
      const id = await queue.enqueue({
        namespace: 'test',
        operation: 'test',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      // Wait for the write to be ready
      await new Promise((resolve) => setTimeout(resolve, 150))

      const success = await queue.processWrite(id, async () => {
        return new Response('OK', { status: 200 })
      })

      expect(success).toBe(true)

      const write = queue.get(id)
      expect(write?.status).toBe('succeeded')
    })

    it('should handle failed write with retry', async () => {
      const id = await queue.enqueue({
        namespace: 'test',
        operation: 'test',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      // Wait for the write to be ready
      await new Promise((resolve) => setTimeout(resolve, 150))

      const success = await queue.processWrite(id, async () => {
        throw new Error('Network error')
      })

      expect(success).toBe(false)

      const write = queue.get(id)
      expect(write?.status).toBe('pending') // Should be pending for retry
      expect(write?.attempts).toBe(1)
      expect(write?.lastError).toContain('Network error')
    })

    it('should abandon after max attempts', async () => {
      const id = await queue.enqueue({
        namespace: 'test',
        operation: 'test',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      // Process until abandoned
      for (let i = 0; i < 4; i++) {
        const write = queue.get(id)
        if (write?.status !== 'pending') break

        // Update nextRetryAt to now
        write.nextRetryAt = Date.now()

        await queue.processWrite(id, async () => {
          throw new Error('Persistent failure')
        })
      }

      const write = queue.get(id)
      expect(write?.status).toBe('abandoned')
    })
  })

  describe('namespace operations', () => {
    it('should get writes for namespace', async () => {
      await queue.enqueue({
        namespace: 'customer-do',
        operation: 'create',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })
      await queue.enqueue({
        namespace: 'order-do',
        operation: 'create',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      const writes = queue.getNamespaceWrites('customer-do')
      expect(writes.length).toBe(1)
      expect(writes[0]?.namespace).toBe('customer-do')
    })

    it('should check for pending writes', async () => {
      await queue.enqueue({
        namespace: 'test-ns',
        operation: 'test',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      expect(queue.hasPendingWrites('test-ns')).toBe(true)
      expect(queue.hasPendingWrites('other-ns')).toBe(false)
    })

    it('should clear namespace writes', async () => {
      await queue.enqueue({
        namespace: 'ns1',
        operation: 'op1',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })
      await queue.enqueue({
        namespace: 'ns2',
        operation: 'op2',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      queue.clearNamespace('ns1')

      expect(queue.hasPendingWrites('ns1')).toBe(false)
      expect(queue.hasPendingWrites('ns2')).toBe(true)
    })
  })

  describe('statistics', () => {
    it('should track statistics', async () => {
      await queue.enqueue({
        namespace: 'ns1',
        operation: 'create',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })
      await queue.enqueue({
        namespace: 'ns2',
        operation: 'update',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'PUT' }),
      })

      const stats = queue.getStats()

      expect(stats.total).toBe(2)
      expect(stats.pending).toBe(2)
      expect(stats.byNamespace['ns1']).toBe(1)
      expect(stats.byNamespace['ns2']).toBe(1)
      expect(stats.byOperation['create']).toBe(1)
      expect(stats.byOperation['update']).toBe(1)
    })

    it('should track pending count', async () => {
      await queue.enqueue({
        namespace: 'test',
        operation: 'op1',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })
      await queue.enqueue({
        namespace: 'test',
        operation: 'op2',
        request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
      })

      expect(queue.getPendingCount()).toBe(2)
    })
  })
})

// ============================================================================
// Degradation Status Tests
// ============================================================================

describe('Degradation Status', () => {
  describe('addDegradationHeaders', () => {
    it('should add degradation headers to response', () => {
      const response = new Response('OK', { status: 200 })
      const status: DegradationStatus = {
        mode: 'degraded',
        accepting: true,
        writesQueued: true,
        pendingWrites: 5,
        mayServeStale: false,
        estimatedRecoveryMs: 30000,
        circuitState: 'half_open',
        healthStatus: 'degraded',
        message: 'System recovering',
        timestamp: Date.now(),
      }

      const enhanced = addDegradationHeaders(response, status)

      expect(enhanced.headers.get('X-Degradation-Mode')).toBe('degraded')
      expect(enhanced.headers.get('X-Degradation-Accepting')).toBe('true')
      expect(enhanced.headers.get('X-Degradation-Writes-Queued')).toBe('true')
      expect(enhanced.headers.get('X-Degradation-Pending-Writes')).toBe('5')
      expect(enhanced.headers.get('X-Circuit-State')).toBe('half_open')
      expect(enhanced.headers.get('Retry-After')).toBe('30')
    })
  })

  describe('parseDegradationHeaders', () => {
    it('should parse degradation headers from response', () => {
      const headers = new Headers({
        'X-Degradation-Mode': 'circuit_open',
        'X-Degradation-Accepting': 'false',
        'X-Degradation-Writes-Queued': 'true',
        'X-Degradation-Pending-Writes': '3',
        'X-Degradation-May-Serve-Stale': 'true',
        'X-Circuit-State': 'open',
        'X-Health-Status': 'unhealthy',
      })
      const response = new Response('', { headers })

      const status = parseDegradationHeaders(response)

      expect(status).not.toBeNull()
      expect(status?.mode).toBe('circuit_open')
      expect(status?.accepting).toBe(false)
      expect(status?.writesQueued).toBe(true)
      expect(status?.pendingWrites).toBe(3)
      expect(status?.circuitState).toBe('open')
    })

    it('should return null if no degradation headers', () => {
      const response = new Response('OK')
      const status = parseDegradationHeaders(response)
      expect(status).toBeNull()
    })
  })
})

// ============================================================================
// Enhanced Graceful Degradation Handler Tests
// ============================================================================

describe('EnhancedGracefulDegradationHandler', () => {
  let handler: EnhancedGracefulDegradationHandler

  beforeEach(() => {
    handler = createEnhancedGracefulDegradationHandler({
      circuitBreakerConfig: {
        failureThreshold: 2,
        resetTimeoutMs: 100,
        timeoutMs: 50,
      },
      healthCheckConfig: {
        timeoutMs: 50,
      },
      fallbackConfig: {
        enableCache: true,
      },
      writeQueueConfig: {
        maxAttempts: 3,
        initialBackoff: 50,
      },
      queueWritesOnFailure: true,
      addStatusHeaders: true,
    })
  })

  describe('degradation status', () => {
    it('should return normal status when healthy', () => {
      const status = handler.getDegradationStatus('healthy-ns')

      expect(status.mode).toBe('normal')
      expect(status.accepting).toBe(true)
      expect(status.circuitState).toBe('closed')
    })

    it('should return circuit_open status when circuit is open', () => {
      const circuit = handler.getCircuit('failing-ns')
      circuit.forceOpen()

      const status = handler.getDegradationStatus('failing-ns')

      expect(status.mode).toBe('circuit_open')
      expect(status.accepting).toBe(false)
      expect(status.circuitState).toBe('open')
    })
  })

  describe('request execution with status', () => {
    it('should include degradation status in response', async () => {
      const request = new Request('https://test.api.dotdo.dev/test')

      const { response, status } = await handler.executeRequest('test', request, async () => {
        return new Response('OK', { status: 200 })
      })

      expect(response.status).toBe(200)
      expect(status.mode).toBe('normal')
      expect(response.headers.get('X-Degradation-Mode')).toBe('normal')
    })

    it('should queue write operations on failure', async () => {
      const request = new Request('https://test.api.dotdo.dev/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice' }),
      })

      const { response, status } = await handler.executeRequest('test', request, async () => {
        throw new Error('Service unavailable')
      })

      expect(response.status).toBe(503)
      // Check that write was queued
      expect(status.writesQueued).toBe(true)
      expect(handler.getWriteQueue().hasPendingWrites('test')).toBe(true)
    })

    it('should not queue read operations', async () => {
      const request = new Request('https://test.api.dotdo.dev/customers') // GET

      await handler.executeRequest('test', request, async () => {
        throw new Error('Service unavailable')
      })

      expect(handler.getWriteQueue().hasPendingWrites('test')).toBe(false)
    })

    it('should serve cached data when available', async () => {
      const request = new Request('https://test.api.dotdo.dev/cached-data')

      // First, cache a successful response
      await handler.executeRequest('cache-test', request, async () => {
        return new Response(JSON.stringify({ data: 'cached' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      // Open circuit
      handler.getCircuit('cache-test').forceOpen()

      // Should serve cached data
      const { response, status } = await handler.executeRequest('cache-test', request, async () => {
        throw new Error('Should not reach')
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('X-Fallback')).toBe('cached')
      expect(status.mode).toBe('stale_data')
    })
  })

  describe('write recovery', () => {
    it('should process pending writes when circuit closes', async () => {
      const request = new Request('https://test.api.dotdo.dev/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      })

      // Queue a write
      await handler.executeRequest('recovery-test', request, async () => {
        throw new Error('Initial failure')
      })

      expect(handler.getWriteQueue().hasPendingWrites('recovery-test')).toBe(true)

      // Wait for backoff
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Attempt recovery
      let executorCalled = false
      await handler.attemptWriteRecovery('recovery-test', async () => {
        executorCalled = true
        return new Response('OK', { status: 201 })
      })

      expect(executorCalled).toBe(true)
    })
  })

  describe('health report with degradation', () => {
    it('should include degradation info in health report', async () => {
      await handler.checkHealth('service-1', async () => ({ healthy: true, latencyMs: 10 }))
      handler.getCircuit('service-2').forceOpen()

      const report = handler.getHealthReport()

      expect(report.degradation).toBeDefined()
      expect(report.degradation['service-1']).toBeDefined()
      expect(report.degradation['service-2']).toBeDefined()
      expect(report.degradation['service-2'].mode).toBe('circuit_open')
    })
  })

  describe('write queue access', () => {
    it('should expose write queue', () => {
      const queue = handler.getWriteQueue()
      expect(queue).toBeDefined()
      expect(typeof queue.enqueue).toBe('function')
    })

    it('should expose write queue stats', async () => {
      const request = new Request('https://test.api.dotdo.dev/test', { method: 'POST' })

      await handler.executeRequest('stats-test', request, async () => {
        throw new Error('Fail')
      })

      const stats = handler.getWriteQueueStats()
      expect(stats.total).toBeGreaterThanOrEqual(1)
    })
  })

  describe('reset', () => {
    it('should reset all state including write queue', async () => {
      // Create some state
      const circuit = handler.getCircuit('reset-test')
      circuit.forceOpen()

      const request = new Request('https://test.api.dotdo.dev/test', { method: 'POST' })
      await handler.executeRequest('reset-test', request, async () => {
        throw new Error('Fail')
      })

      handler.reset()

      // Verify reset
      expect(handler.getCircuit('reset-test').getState()).toBe('closed')
      expect(handler.getWriteQueue().getPendingCount()).toBe(0)
    })
  })
})

// ============================================================================
// Write Queue Callbacks Tests
// ============================================================================

describe('WriteQueue Callbacks', () => {
  it('should call onWriteSuccess callback', async () => {
    const onWriteSuccess = vi.fn()
    const queue = createWriteQueue({
      maxAttempts: 3,
      initialBackoff: 10,
      onWriteSuccess,
    })

    const id = await queue.enqueue({
      namespace: 'test',
      operation: 'test',
      request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
    })

    // Wait for ready
    await new Promise((resolve) => setTimeout(resolve, 20))

    await queue.processWrite(id, async () => new Response('OK', { status: 200 }))

    expect(onWriteSuccess).toHaveBeenCalledTimes(1)
    expect(onWriteSuccess).toHaveBeenCalledWith(expect.objectContaining({ id, status: 'succeeded' }))
  })

  it('should call onWriteAbandoned callback', async () => {
    const onWriteAbandoned = vi.fn()
    const queue = createWriteQueue({
      maxAttempts: 1, // Only 1 attempt
      initialBackoff: 10,
      onWriteAbandoned,
    })

    const id = await queue.enqueue({
      namespace: 'test',
      operation: 'test',
      request: new Request('https://test.api.dotdo.dev/test', { method: 'POST' }),
    })

    // Wait for ready
    await new Promise((resolve) => setTimeout(resolve, 20))

    await queue.processWrite(id, async () => {
      throw new Error('Permanent failure')
    })

    expect(onWriteAbandoned).toHaveBeenCalledTimes(1)
    expect(onWriteAbandoned).toHaveBeenCalledWith(expect.objectContaining({ id, status: 'abandoned' }))
  })
})
