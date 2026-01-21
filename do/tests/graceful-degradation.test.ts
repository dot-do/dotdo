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
  type HealthStatus,
  type FallbackContext,
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
