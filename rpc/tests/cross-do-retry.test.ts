import { describe, it, expect, vi } from 'vitest'
import { createCrossDOClient, CrossDOStubCache, CrossDOContext, DEFAULT_CROSS_DO_RETRY } from '../cross-do'

/**
 * Tests for cross-DO retry logic and circuit breaker default-on behavior (do-bkkfj)
 */
describe('Cross-DO Retry Logic (do-bkkfj)', () => {
  describe('createCrossDOClient retry', () => {
    it('should retry on transient 500 errors and eventually succeed', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            if (callCount < 3) {
              return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
            }
            return new Response(JSON.stringify(42), { status: 200 })
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 },
      })
      const result = await client.getValue()

      expect(result).toBe(42)
      expect(callCount).toBe(3) // 2 failures + 1 success
    })

    it('should NOT retry on 404 errors (permanent)', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            return new Response(
              JSON.stringify({
                type: 'NotFoundError',
                name: 'NotFoundError',
                code: 'NOT_FOUND',
                message: 'Not found',
              }),
              { status: 404 }
            )
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 },
      })

      await expect(client.getValue()).rejects.toThrow('Not found')
      expect(callCount).toBe(1) // No retries for 4xx
    })

    it('should NOT retry on 400 validation errors (permanent)', async () => {
      interface TestDO {
        setValue(v: number): Promise<void>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            return new Response(
              JSON.stringify({
                type: 'ValidationError',
                name: 'ValidationError',
                code: 'VALIDATION_ERROR',
                message: 'Invalid input',
              }),
              { status: 400 }
            )
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 },
      })

      await expect(client.setValue(42)).rejects.toThrow('Invalid input')
      expect(callCount).toBe(1) // No retries for validation errors
    })

    it('should NOT retry on 401 auth errors (permanent)', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            return new Response(
              JSON.stringify({
                type: 'AuthenticationError',
                name: 'AuthenticationError',
                code: 'AUTHENTICATION_ERROR',
                message: 'Unauthorized',
              }),
              { status: 401 }
            )
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 },
      })

      await expect(client.getValue()).rejects.toThrow('Unauthorized')
      expect(callCount).toBe(1) // No retries for auth errors
    })

    it('should retry on network errors (transport failures)', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            if (callCount < 3) {
              throw new Error('Network failure')
            }
            return new Response(JSON.stringify(42), { status: 200 })
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 },
      })
      const result = await client.getValue()

      expect(result).toBe(42)
      expect(callCount).toBe(3) // 2 transport failures + 1 success
    })

    it('should throw after exhausting all retries', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: { maxRetries: 2, baseDelay: 1, maxDelay: 10 },
      })

      await expect(client.getValue()).rejects.toThrow()
      expect(callCount).toBe(3) // 1 initial + 2 retries
    })

    it('should disable retry when retry is set to false', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do', undefined, {
        retry: false,
      })

      await expect(client.getValue()).rejects.toThrow()
      expect(callCount).toBe(1) // No retries
    })

    it('should use default retry config when no retry option is provided', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            if (callCount <= DEFAULT_CROSS_DO_RETRY.maxRetries) {
              return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
            }
            return new Response(JSON.stringify(42), { status: 200 })
          },
        }),
      } as unknown as DurableObjectNamespace

      // No retry option provided — should use defaults (maxRetries: 3)
      const client = createCrossDOClient<TestDO>(mockBinding, 'test-do')
      const result = await client.getValue()

      expect(result).toBe(42)
      // Default maxRetries is 3, so we get 3 failures + 1 success = 4 calls
      expect(callCount).toBe(DEFAULT_CROSS_DO_RETRY.maxRetries + 1)
    })

    it('should retry fetch() method on transient errors', async () => {
      let callCount = 0
      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async () => {
            callCount++
            if (callCount < 2) {
              return new Response(JSON.stringify({ error: 'Server error' }), { status: 503 })
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
          },
        }),
      } as unknown as DurableObjectNamespace

      const client = createCrossDOClient<{ fetch: (url: string) => Promise<unknown> }>(
        mockBinding,
        'test-do',
        undefined,
        { retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 } }
      )
      const result = await client.fetch('/')

      expect(result).toEqual({ ok: true })
      expect(callCount).toBe(2)
    })
  })

  describe('CrossDOContext circuit breaker default-on (do-bkkfj)', () => {
    it('should have circuit breaker enabled by default', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      const mockEnv = {
        Test: {
          idFromName: () => ({ toString: () => 'test-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify(42)),
          }),
        } as unknown as DurableObjectNamespace,
      }

      // Default constructor — circuit breaker should be on
      const $ = new CrossDOContext(mockEnv)
      const result = await $.Test<TestDO>('test-1').getValue()
      expect(result).toBe(42)

      // The client should expose $circuit property (circuit breaker wrapper)
      const client = $.Test<TestDO & { $circuit: { getState(): string } }>('test-1')
      const state = client.$circuit.getState()
      expect(state).toBe('closed') // Circuit starts closed
    })

    it('should allow disabling circuit breaker via options', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      const mockEnv = {
        Test: {
          idFromName: () => ({ toString: () => 'test-id' }),
          get: () => ({
            fetch: async () => new Response(JSON.stringify(42)),
          }),
        } as unknown as DurableObjectNamespace,
      }

      // Explicitly disable circuit breaker
      const $ = new CrossDOContext(mockEnv, { circuitBreaker: false })
      const client = $.Test<TestDO & { $circuit?: unknown }>('test-1')

      // Without circuit breaker, $circuit should NOT be defined
      // (Proxy returns a function for any property, so check the result differently)
      const result = await client.getValue()
      expect(result).toBe(42)
    })

    it('should pass retry config through CrossDOContext', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockEnv = {
        Test: {
          idFromName: () => ({ toString: () => 'test-id' }),
          get: () => ({
            fetch: async () => {
              callCount++
              if (callCount < 2) {
                return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
              }
              return new Response(JSON.stringify(42))
            },
          }),
        } as unknown as DurableObjectNamespace,
      }

      const $ = new CrossDOContext(mockEnv, {
        retry: { maxRetries: 3, baseDelay: 1, maxDelay: 10 },
        circuitBreaker: false, // Disable to isolate retry behavior
      })

      const result = await $.Test<TestDO>('test-1').getValue()
      expect(result).toBe(42)
      expect(callCount).toBe(2) // 1 failure + 1 success
    })

    it('should disable retry when CrossDOContext retry is false', async () => {
      interface TestDO {
        getValue(): Promise<number>
      }

      let callCount = 0
      const mockEnv = {
        Test: {
          idFromName: () => ({ toString: () => 'test-id' }),
          get: () => ({
            fetch: async () => {
              callCount++
              return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
            },
          }),
        } as unknown as DurableObjectNamespace,
      }

      const $ = new CrossDOContext(mockEnv, {
        retry: false,
        circuitBreaker: false,
      })

      await expect($.Test<TestDO>('test-1').getValue()).rejects.toThrow()
      expect(callCount).toBe(1) // No retries
    })
  })

  describe('DEFAULT_CROSS_DO_RETRY', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CROSS_DO_RETRY.maxRetries).toBe(3)
      expect(DEFAULT_CROSS_DO_RETRY.baseDelay).toBe(100)
      expect(DEFAULT_CROSS_DO_RETRY.maxDelay).toBe(5000)
    })
  })
})
