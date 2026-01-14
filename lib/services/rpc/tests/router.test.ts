/**
 * Router Tests
 *
 * Tests for the gateway router including:
 * - Service discovery
 * - Request routing
 * - Batch execution
 * - Error handling
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GatewayRouter,
  createRouter,
  createDefaultRegistry,
  InMemoryServiceRegistry,
  ServiceError,
} from '../src/router'
import type { GatewayRequest, GatewayResponse, BatchedRequest, ServiceDefinition, ServiceEndpoint } from '../src/types'

describe('Router', () => {
  let registry: InMemoryServiceRegistry
  let router: GatewayRouter

  beforeEach(() => {
    registry = createDefaultRegistry()
    router = createRouter({ registry })
  })

  describe('Service Registry', () => {
    it('should list default services', () => {
      const services = registry.listServices()
      expect(services.length).toBeGreaterThan(0)
      expect(services.map((s) => s.name)).toContain('agents')
      expect(services.map((s) => s.name)).toContain('workers')
      expect(services.map((s) => s.name)).toContain('llm')
    })

    it('should get service by name', () => {
      const service = registry.getService('agents')
      expect(service).toBeDefined()
      expect(service?.name).toBe('agents')
      expect(service?.domain).toBe('agents.do')
    })

    it('should get service by domain', () => {
      const service = registry.getService('agents.do')
      expect(service).toBeDefined()
      expect(service?.name).toBe('agents')
    })

    it('should return undefined for unknown service', () => {
      const service = registry.getService('nonexistent')
      expect(service).toBeUndefined()
    })

    it('should check if service exists', () => {
      expect(registry.hasService('agents')).toBe(true)
      expect(registry.hasService('nonexistent')).toBe(false)
    })

    it('should register custom service', () => {
      const customService: ServiceDefinition = {
        name: 'custom',
        domain: 'custom.do',
        description: 'Custom service',
        methods: [{ name: 'test', costUnits: 1 }],
        active: true,
      }
      const endpoint: ServiceEndpoint = { domain: 'custom.do', healthy: true }

      registry.register(customService, endpoint)

      expect(registry.hasService('custom')).toBe(true)
      expect(registry.getService('custom')?.name).toBe('custom')
    })
  })

  describe('Request Routing', () => {
    it('should validate request with missing ID', async () => {
      const request = {
        id: '',
        service: 'agents',
        method: 'list',
      } as GatewayRequest

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await router.route(request, context)
      expect(response.status).toBe('error')
      expect(response.error?.code).toBe('INVALID_REQUEST')
    })

    it('should validate request with missing service', async () => {
      const request = {
        id: 'req-1',
        service: '',
        method: 'list',
      } as GatewayRequest

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await router.route(request, context)
      expect(response.status).toBe('error')
      expect(response.error?.code).toBe('INVALID_REQUEST')
    })

    it('should validate request with missing method', async () => {
      const request = {
        id: 'req-1',
        service: 'agents',
        method: '',
      } as GatewayRequest

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await router.route(request, context)
      expect(response.status).toBe('error')
      expect(response.error?.code).toBe('INVALID_REQUEST')
    })

    it('should return error for unknown service', async () => {
      const request: GatewayRequest = {
        id: 'req-1',
        service: 'nonexistent',
        method: 'test',
      }

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await router.route(request, context)
      expect(response.status).toBe('error')
      expect(response.error?.code).toBe('SERVICE_NOT_FOUND')
    })

    it('should include request ID in response', async () => {
      const request: GatewayRequest = {
        id: 'my-request-id',
        service: 'agents',
        method: 'list',
      }

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await router.route(request, context)
      expect(response.id).toBe('my-request-id')
    })

    it('should include metadata in response', async () => {
      const request: GatewayRequest = {
        id: 'req-1',
        service: 'agents',
        method: 'list',
      }

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
        traceId: 'trace-123',
      }

      const response = await router.route(request, context)
      // Even if service call fails, metadata should be present
      expect(response.meta).toBeDefined()
      expect(response.meta?.service).toBe('agents')
    })
  })

  describe('Batch Routing', () => {
    it('should validate batch size limit', async () => {
      // Create router with small batch size
      const smallBatchRouter = createRouter({
        registry,
        maxBatchSize: 5,
      })

      const batch: BatchedRequest = {
        id: 'batch-1',
        requests: Array.from({ length: 10 }, (_, i) => ({
          id: `req-${i}`,
          service: 'agents',
          method: 'list',
        })),
      }

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await smallBatchRouter.routeBatch(batch, context)
      expect(response.id).toBe('batch-1')
      // All responses should be errors
      expect(response.responses.every((r) => r.error?.code === 'BATCH_TOO_LARGE')).toBe(true)
    })

    it('should return responses in original order', async () => {
      const batch: BatchedRequest = {
        id: 'batch-1',
        requests: [
          { id: 'req-a', service: 'agents', method: 'list' },
          { id: 'req-b', service: 'workers', method: 'list' },
          { id: 'req-c', service: 'llm', method: 'models' },
        ],
      }

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await smallBatchRouter.routeBatch(batch, context)
      expect(response.responses[0].id).toBe('req-a')
      expect(response.responses[1].id).toBe('req-b')
      expect(response.responses[2].id).toBe('req-c')
    })

    it('should include total duration', async () => {
      const batch: BatchedRequest = {
        id: 'batch-1',
        requests: [{ id: 'req-1', service: 'agents', method: 'list' }],
      }

      const context = {
        requestId: 'test-req-1',
        startTime: performance.now(),
      }

      const response = await router.routeBatch(batch, context)
      expect(response.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Service Discovery', () => {
    it('should list all available services', () => {
      const services = router.listServices()
      expect(services.length).toBeGreaterThan(0)
    })

    it('should get service details', () => {
      const service = router.getService('llm')
      expect(service).toBeDefined()
      expect(service?.methods.length).toBeGreaterThan(0)
      expect(service?.methods.map((m) => m.name)).toContain('complete')
    })
  })

  describe('ServiceError', () => {
    it('should create service error with code', () => {
      const error = new ServiceError('Test error', 'TEST_CODE', true)
      expect(error.message).toBe('Test error')
      expect(error.code).toBe('TEST_CODE')
      expect(error.retryable).toBe(true)
      expect(error.name).toBe('ServiceError')
    })
  })
})

// Create a reference for tests that need a router with limited batch size
let smallBatchRouter: GatewayRouter

beforeEach(() => {
  const registry = createDefaultRegistry()
  smallBatchRouter = createRouter({
    registry,
    maxBatchSize: 5,
  })
})
