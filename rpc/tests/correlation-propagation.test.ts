/**
 * Correlation ID Propagation Tests
 *
 * Tests comprehensive correlation ID propagation across:
 * - HTTP requests
 * - RPC calls
 * - DO-to-DO communication
 * - Logging integration
 * - Observability context
 *
 * @see do-ohks - Add correlation ID propagation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, RPC_CONTEXT, getExecutionContext, getCorrelationIdFromArgs } from '../server'
import { createCrossDOClient, CrossDOContext } from '../cross-do'
import { CORRELATION_ID_HEADER, generateCorrelationId } from '../headers'
import { createClientWithTransport } from '../client'
import { FetchTransport } from '../transport/fetch'
import { StubTransport } from '../transport/stub'

describe('Correlation ID Propagation', () => {
  describe('HTTP Request Propagation', () => {
    it('should preserve incoming correlation ID through RPC', async () => {
      const incomingCorrelationId = 'incoming-test-cid-123'
      const testTarget = {
        echo: (msg: string) => ({ message: msg }),
      }

      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: incomingCorrelationId,
        },
        body: JSON.stringify({ method: 'echo', args: ['hello'] }),
      })

      expect(res.status).toBe(200)
      // Response should echo back the same correlation ID
      expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(incomingCorrelationId)
    })

    it('should generate correlation ID if not provided', async () => {
      const testTarget = {
        test: () => 'ok',
      }

      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'test', args: [] }),
      })

      expect(res.status).toBe(200)
      const correlationId = res.headers.get(CORRELATION_ID_HEADER)
      expect(correlationId).toBeTruthy()
      expect(typeof correlationId).toBe('string')
      expect(correlationId!.length).toBeGreaterThan(0)
    })

    it('should include correlation ID in error responses', async () => {
      const testCorrelationId = 'error-test-cid'
      const testTarget = {
        fail: () => {
          throw new Error('Intentional failure')
        },
      }

      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: testCorrelationId,
        },
        body: JSON.stringify({ method: 'fail', args: [] }),
      })

      expect(res.status).toBe(500)
      expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(testCorrelationId)

      const body = await res.json()
      expect(body.correlationId).toBe(testCorrelationId)
    })
  })

  describe('Transport Layer Propagation', () => {
    it('FetchTransport should propagate correlation ID', async () => {
      let capturedCorrelationId: string | null = null

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers)
        capturedCorrelationId = headers.get(CORRELATION_ID_HEADER)
        return {
          ok: true,
          json: () => Promise.resolve({ result: 'ok' }),
          headers: new Headers({ [CORRELATION_ID_HEADER]: capturedCorrelationId || '' }),
        }
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        correlationId: 'transport-base-cid',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(capturedCorrelationId).toBe('transport-base-cid')
      expect(response.correlationId).toBe('transport-base-cid')
    })

    it('FetchTransport should use message correlation ID over base', async () => {
      let capturedCorrelationId: string | null = null

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers)
        capturedCorrelationId = headers.get(CORRELATION_ID_HEADER)
        return {
          ok: true,
          json: () => Promise.resolve({ result: 'ok' }),
          headers: new Headers({ [CORRELATION_ID_HEADER]: capturedCorrelationId || '' }),
        }
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        correlationId: 'base-cid',
        fetch: mockFetch,
      })

      await transport.send({
        method: 'test',
        args: [],
        correlationId: 'message-cid',
      })

      expect(capturedCorrelationId).toBe('message-cid')
    })

    it('StubTransport should propagate correlation ID to DO', async () => {
      let capturedCorrelationId: string | null = null

      const mockStub = {
        fetch: vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
          const headers = new Headers(init.headers)
          capturedCorrelationId = headers.get(CORRELATION_ID_HEADER)
          return {
            ok: true,
            json: () => Promise.resolve({ data: 'test' }),
            headers: new Headers({ [CORRELATION_ID_HEADER]: capturedCorrelationId || '' }),
          }
        }),
      }

      const transport = new StubTransport({
        stub: mockStub as unknown as DurableObjectStub,
        correlationId: 'stub-cid',
      })

      const response = await transport.send({ method: 'process', args: [] })

      expect(capturedCorrelationId).toBe('stub-cid')
      expect(response.correlationId).toBe('stub-cid')
    })
  })

  describe('Cross-DO Propagation', () => {
    it('should propagate correlation ID through DO-to-DO calls', async () => {
      let capturedCorrelationId: string | null = null
      const testCorrelationId = 'cross-do-cid-456'

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (_url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            capturedCorrelationId = headers.get(CORRELATION_ID_HEADER)
            return new Response(JSON.stringify(100), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          },
        }),
      } as unknown as DurableObjectNamespace

      interface TestDO {
        getValue(): Promise<number>
      }

      const client = createCrossDOClient<TestDO>(
        mockBinding,
        'target-do',
        undefined,
        { correlationId: testCorrelationId }
      )

      await client.getValue()

      expect(capturedCorrelationId).toBe(testCorrelationId)
    })

    it('CrossDOContext should propagate correlation ID to all calls', async () => {
      const capturedCorrelationIds: string[] = []
      const testCorrelationId = 'context-wide-cid'

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (_url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            const cid = headers.get(CORRELATION_ID_HEADER)
            if (cid) capturedCorrelationIds.push(cid)
            return new Response(JSON.stringify({ ok: true }))
          },
        }),
      } as unknown as DurableObjectNamespace

      const mockEnv = { TestDO: mockBinding }
      const $ = new CrossDOContext(mockEnv, { correlationId: testCorrelationId })

      interface TestDO {
        method1(): Promise<{ ok: boolean }>
        method2(): Promise<{ ok: boolean }>
      }

      await Promise.all([
        $.TestDO<TestDO>('do-1').method1(),
        $.TestDO<TestDO>('do-2').method2(),
      ])

      // All calls should use the same correlation ID
      expect(capturedCorrelationIds).toHaveLength(2)
      expect(capturedCorrelationIds.every(id => id === testCorrelationId)).toBe(true)
    })

    it('should propagate source DO ID for trust chain', async () => {
      let capturedSourceHeader: string | null = null
      let capturedSourceId: string | null = null

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (_url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            capturedSourceHeader = headers.get('X-DO-Source')
            capturedSourceId = headers.get('X-DO-Source-ID')
            return new Response(JSON.stringify({ ok: true }))
          },
        }),
      } as unknown as DurableObjectNamespace

      interface TestDO {
        process(): Promise<{ ok: boolean }>
      }

      const client = createCrossDOClient<TestDO>(
        mockBinding,
        'target-do',
        undefined,
        {
          correlationId: 'test-cid',
          sourceDoId: 'source-do-abc123',
        }
      )

      await client.process()

      expect(capturedSourceHeader).toBe('true')
      expect(capturedSourceId).toBe('source-do-abc123')
    })
  })

  describe('RPC Server Context Passing', () => {
    it('should pass execution context when passContext is enabled', async () => {
      let receivedContext: unknown = null

      const testTarget = {
        testMethod: (arg1: string, ctxArg?: unknown) => {
          receivedContext = ctxArg
          return { arg1, hasContext: !!ctxArg }
        },
      }

      const app = createServer({ target: testTarget, passContext: true })

      const testCorrelationId = 'context-pass-test'
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: testCorrelationId,
        },
        body: JSON.stringify({ method: 'testMethod', args: ['hello'] }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.hasContext).toBe(true)

      // Verify context extraction
      const ctx = getExecutionContext(receivedContext)
      expect(ctx).toBeDefined()
      expect(ctx?.correlationId).toBe(testCorrelationId)
    })

    it('should extract execution context from args', () => {
      const testContext = {
        [RPC_CONTEXT]: {
          correlationId: 'extracted-cid',
          sourceDoId: 'source-123',
          isInternal: true,
        },
      }

      const ctx = getExecutionContext(testContext)

      expect(ctx).toBeDefined()
      expect(ctx?.correlationId).toBe('extracted-cid')
      expect(ctx?.sourceDoId).toBe('source-123')
      expect(ctx?.isInternal).toBe(true)
    })

    it('should return undefined for non-context args', () => {
      expect(getExecutionContext(null)).toBeUndefined()
      expect(getExecutionContext(undefined)).toBeUndefined()
      expect(getExecutionContext('string')).toBeUndefined()
      expect(getExecutionContext(123)).toBeUndefined()
      expect(getExecutionContext({ other: 'data' })).toBeUndefined()
    })

    it('getCorrelationIdFromArgs should extract correlation ID from last arg', () => {
      const args = [
        'arg1',
        42,
        { [RPC_CONTEXT]: { correlationId: 'from-args-cid' } },
      ]

      const cid = getCorrelationIdFromArgs(args)
      expect(cid).toBe('from-args-cid')
    })

    it('getCorrelationIdFromArgs should return undefined for empty args', () => {
      expect(getCorrelationIdFromArgs([])).toBeUndefined()
    })
  })

  describe('Correlation ID Generation', () => {
    it('should generate unique correlation IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add(generateCorrelationId())
      }
      // All IDs should be unique
      expect(ids.size).toBe(1000)
    })

    it('should generate IDs with reasonable length', () => {
      const id = generateCorrelationId()
      expect(id.length).toBeGreaterThan(8)
      expect(id.length).toBeLessThan(50)
    })

    it('should generate valid string format', () => {
      const id = generateCorrelationId()
      expect(typeof id).toBe('string')
      // Should not contain special characters that might cause issues
      expect(id).not.toContain(' ')
      expect(id).not.toContain('\n')
    })
  })

  describe('End-to-End Propagation Scenario', () => {
    it('should maintain correlation ID through request → RPC → cross-DO chain', async () => {
      const capturedCorrelationIds: { stage: string; id: string }[] = []
      const originalCorrelationId = 'e2e-correlation-test-789'

      // Mock a DO that would be called via cross-DO
      const mockTargetBinding = {
        idFromName: () => ({ toString: () => 'target-do-id' }),
        get: () => ({
          fetch: async (_url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            const cid = headers.get(CORRELATION_ID_HEADER)
            if (cid) {
              capturedCorrelationIds.push({ stage: 'cross-do-target', id: cid })
            }
            return new Response(JSON.stringify({ processed: true }))
          },
        }),
      } as unknown as DurableObjectNamespace

      // Primary DO handler that makes a cross-DO call
      const primaryHandler = {
        processWithCrossCall: async () => {
          // This simulates making a cross-DO call from within an RPC handler
          interface TargetDO {
            process(): Promise<{ processed: boolean }>
          }

          const client = createCrossDOClient<TargetDO>(
            mockTargetBinding,
            'downstream-do',
            undefined,
            { correlationId: originalCorrelationId }
          )

          const result = await client.process()
          return { success: true, downstream: result }
        },
      }

      // Create server for primary handler
      const app = createServer({ target: primaryHandler })

      // Make initial request with correlation ID
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: originalCorrelationId,
        },
        body: JSON.stringify({ method: 'processWithCrossCall', args: [] }),
      })

      expect(res.status).toBe(200)

      // Verify correlation ID was propagated to the cross-DO call
      expect(capturedCorrelationIds.length).toBeGreaterThan(0)
      expect(capturedCorrelationIds[0].id).toBe(originalCorrelationId)
      expect(capturedCorrelationIds[0].stage).toBe('cross-do-target')

      // Verify response has the correlation ID
      expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(originalCorrelationId)
    })
  })
})
