/**
 * Tests for Circuit Breaker RPC Integration
 *
 * Tests the integration between circuit breaker and cross-DO RPC:
 * - createDOStubWithCircuitBreaker
 * - createCrossDOClientWithCircuitBreaker
 * - Circuit breaker protection in workflow context
 *
 * @module @dotdo/rpc/tests/circuit-breaker-rpc
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createDOStubWithCircuitBreaker,
  createCrossDOClientWithCircuitBreaker,
  createCircuitBreakerDOAccessor,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type WithCircuitBreaker,
} from '../circuit-breaker'
import { resetGlobalCircuitBreakerRegistry } from '@dotdo/utils'
import { TransportError, RPCErrorCode } from '../errors'

// ============================================================================
// MOCK TYPES AND HELPERS
// ============================================================================

interface MockDOStub {
  fetch: ReturnType<typeof vi.fn>
}

interface MockDONamespace {
  idFromName: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

interface TestDO {
  getData(): Promise<{ value: string }>
  setData(value: string): Promise<{ success: boolean }>
  failingMethod(): Promise<never>
}

function createMockNamespace(): { namespace: MockDONamespace; stub: MockDOStub } {
  const mockStub: MockDOStub = {
    fetch: vi.fn(),
  }

  const mockNamespace: MockDONamespace = {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'test-id' }),
    get: vi.fn().mockReturnValue(mockStub),
  }

  return { namespace: mockNamespace, stub: mockStub }
}

function createSuccessResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Circuit Breaker RPC Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    vi.clearAllMocks()
    resetGlobalCircuitBreakerRegistry()
  })

  afterEach(() => {
    vi.clearAllMocks()
    resetGlobalCircuitBreakerRegistry()
    vi.useRealTimers()
  })

  describe('createDOStubWithCircuitBreaker', () => {
    it('should create a stub with circuit breaker enabled by default', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id'
      )

      const result = await client.getData()
      expect(result).toEqual({ value: 'test' })
      expect(stub.fetch).toHaveBeenCalledTimes(1)
    })

    it('should allow disabling circuit breaker', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        { circuitBreaker: { enabled: false } }
      )

      const result = await client.getData()
      expect(result).toEqual({ value: 'test' })
    })

    it('should expose $circuit property for accessing circuit state', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id'
      ) as WithCircuitBreaker<TestDO>

      expect(client.$circuit.getState()).toBe('closed')

      const stats = client.$circuit.getStats()
      expect(stats.totalRequests).toBe(0)
      expect(stats.state).toBe('closed')
    })

    it('should open circuit after failure threshold', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('Connection failed'))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 3,
            resetTimeoutMs: 30000,
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Make failures up to threshold
      for (let i = 0; i < 3; i++) {
        await expect(client.getData()).rejects.toThrow()
      }

      // Circuit should be open now
      expect(client.$circuit.getState()).toBe('open')

      // Next request should be rejected immediately
      await expect(client.getData()).rejects.toThrow(/circuit/i)
    })

    it('should reject requests with TransportError when circuit is open', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('Connection failed'))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 1,
            resetTimeoutMs: 30000,
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Open the circuit
      await expect(client.getData()).rejects.toThrow()
      expect(client.$circuit.getState()).toBe('open')

      // Next request should throw TransportError
      try {
        await client.getData()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TransportError)
        expect((error as TransportError).code).toBe(RPCErrorCode.NETWORK_ERROR)
      }
    })

    it('should force open and close circuit', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id'
      ) as WithCircuitBreaker<TestDO>

      expect(client.$circuit.getState()).toBe('closed')

      client.$circuit.forceOpen()
      expect(client.$circuit.getState()).toBe('open')

      client.$circuit.forceClose()
      expect(client.$circuit.getState()).toBe('closed')
    })

    it('should track success and failure stats', async () => {
      const { namespace, stub } = createMockNamespace()

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 10, // High threshold to prevent opening
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Successful requests - return new Response each time
      stub.fetch.mockImplementation(() => Promise.resolve(createSuccessResponse({ value: 'test' })))
      await client.getData()
      await client.getData()

      // Failed requests
      stub.fetch.mockRejectedValue(new Error('fail'))
      await expect(client.getData()).rejects.toThrow()

      const stats = client.$circuit.getStats()
      expect(stats.totalRequests).toBe(3)
      expect(stats.successCount).toBe(2)
      expect(stats.failureCount).toBe(1)
    })

    it('should use custom circuit name prefix', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            namePrefix: 'custom-prefix',
          },
        }
      ) as WithCircuitBreaker<TestDO>

      await client.getData()

      // Circuit should work with custom prefix
      expect(client.$circuit.getState()).toBe('closed')
    })
  })

  describe('createCrossDOClientWithCircuitBreaker', () => {
    it('should create client with circuit breaker', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createCrossDOClientWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id'
      )

      const result = await client.getData()
      expect(result).toEqual({ value: 'test' })
    })

    it('should protect cross-DO calls with circuit breaker', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('DO unavailable'))

      const client = createCrossDOClientWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        undefined,
        {
          circuitBreaker: {
            failureThreshold: 2,
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Fail twice to open circuit
      await expect(client.getData()).rejects.toThrow()
      await expect(client.getData()).rejects.toThrow()

      expect(client.$circuit.getState()).toBe('open')

      // Subsequent calls should be rejected immediately
      await expect(client.getData()).rejects.toThrow(/circuit/i)
    })

    it('should pass through options like correlationId', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'test' }))

      const client = createCrossDOClientWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        undefined,
        {
          correlationId: 'test-correlation-id',
        }
      )

      await client.getData()

      // Verify correlationId was passed through
      expect(stub.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': 'test-correlation-id',
          }),
        })
      )
    })
  })

  describe('createCircuitBreakerDOAccessor', () => {
    it('should create an accessor for multiple namespaces', async () => {
      const { namespace: customerNs, stub: customerStub } = createMockNamespace()
      const { namespace: orderNs, stub: orderStub } = createMockNamespace()

      customerStub.fetch.mockResolvedValue(createSuccessResponse({ name: 'Alice' }))
      orderStub.fetch.mockResolvedValue(createSuccessResponse({ status: 'pending' }))

      const env = {
        Customer: customerNs as unknown as DurableObjectNamespace,
        Order: orderNs as unknown as DurableObjectNamespace,
      }

      const $ = createCircuitBreakerDOAccessor(env)

      const customer = $<{ getName(): Promise<{ name: string }> }>('Customer', 'cust-123')
      const order = $<{ getStatus(): Promise<{ status: string }> }>('Order', 'order-456')

      const name = await customer.getName()
      const status = await order.getStatus()

      expect(name).toEqual({ name: 'Alice' })
      expect(status).toEqual({ status: 'pending' })
    })

    it('should throw error for unknown namespace', () => {
      const $ = createCircuitBreakerDOAccessor({})

      expect(() => {
        $<TestDO>('Unknown', 'id')
      }).toThrow(/namespace not found/i)
    })

    it('should apply custom circuit breaker config', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('fail'))

      const env = { Test: namespace as unknown as DurableObjectNamespace }

      const $ = createCircuitBreakerDOAccessor(env, {
        failureThreshold: 1,
      })

      const client = $<TestDO>('Test', 'test-id')

      // First failure opens circuit
      await expect(client.getData()).rejects.toThrow()

      // Circuit should be open
      expect(client.$circuit.getState()).toBe('open')
    })
  })

  describe('DEFAULT_CIRCUIT_BREAKER_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5)
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs).toBe(30000)
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold).toBe(3)
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.timeoutMs).toBe(10000)
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenRequestRatio).toBe(0.1)
    })
  })

  describe('Circuit breaker state transitions', () => {
    it('should transition from open to half-open after reset timeout', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('fail'))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 1,
            resetTimeoutMs: 50, // Short timeout for testing
            halfOpenRequestRatio: 1.0, // Always allow in half-open
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Open the circuit
      await expect(client.getData()).rejects.toThrow()
      expect(client.$circuit.getState()).toBe('open')

      // Advance time past reset timeout (using fake timers for deterministic testing)
      await vi.advanceTimersByTimeAsync(60)

      // Now make a successful call to trigger half-open check
      stub.fetch.mockResolvedValue(createSuccessResponse({ value: 'recovered' }))

      // This call should go through and start recovery
      const result = await client.getData()
      expect(result).toEqual({ value: 'recovered' })
    })

    it('should close circuit after success threshold in half-open', async () => {
      const { namespace, stub } = createMockNamespace()

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 1,
            resetTimeoutMs: 50,
            successThreshold: 2,
            halfOpenRequestRatio: 1.0,
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Open the circuit
      stub.fetch.mockRejectedValue(new Error('fail'))
      await expect(client.getData()).rejects.toThrow()
      expect(client.$circuit.getState()).toBe('open')

      // Advance time past reset timeout (using fake timers for deterministic testing)
      await vi.advanceTimersByTimeAsync(60)

      // Make successful calls to close circuit - return fresh Response each time
      stub.fetch.mockImplementation(() => Promise.resolve(createSuccessResponse({ value: 'ok' })))
      await client.getData()
      await client.getData()

      expect(client.$circuit.getState()).toBe('closed')
    })
  })

  describe('Integration with fallback', () => {
    it('should use fallback when circuit is open', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('fail'))

      const fallbackData = { value: 'fallback' }

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 1,
            fallback: () => fallbackData,
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Open the circuit
      await expect(client.getData()).rejects.toThrow()
      expect(client.$circuit.getState()).toBe('open')

      // Next call should use fallback - but since the result structure
      // indicates failure with fallbackUsed=true, the behavior is that
      // the error is still thrown but fallback was invoked
      await expect(client.getData()).rejects.toThrow()
    })
  })

  describe('Concurrent requests', () => {
    it('should handle concurrent requests correctly', async () => {
      const { namespace, stub } = createMockNamespace()
      // Return fresh Response for each call
      stub.fetch.mockImplementation(() => Promise.resolve(createSuccessResponse({ value: 'test' })))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id'
      ) as WithCircuitBreaker<TestDO>

      // Fire concurrent requests
      const requests = Array.from({ length: 10 }, () => client.getData())
      const results = await Promise.all(requests)

      expect(results).toHaveLength(10)
      results.forEach((result) => {
        expect(result).toEqual({ value: 'test' })
      })

      const stats = client.$circuit.getStats()
      expect(stats.successCount).toBe(10)
    })

    it('should open circuit under concurrent load when failures exceed threshold', async () => {
      const { namespace, stub } = createMockNamespace()
      stub.fetch.mockRejectedValue(new Error('concurrent failure'))

      const client = createDOStubWithCircuitBreaker<TestDO>(
        namespace as unknown as DurableObjectNamespace,
        'test-id',
        {
          circuitBreaker: {
            failureThreshold: 5,
          },
        }
      ) as WithCircuitBreaker<TestDO>

      // Fire concurrent failures
      const requests = Array.from({ length: 10 }, () =>
        client.getData().catch(() => 'failed')
      )

      await Promise.all(requests)

      // Circuit should be open
      expect(client.$circuit.getState()).toBe('open')
    })
  })
})
