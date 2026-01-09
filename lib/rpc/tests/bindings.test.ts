/**
 * RPC Binding Tests
 *
 * Tests for the RPC binding architecture including:
 * - Type-safe method calls
 * - Error handling and retries
 * - Streaming responses
 * - Fallback behavior
 * - Capability module bindings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RPCBinding,
  RPCBindingError,
  RPCTimeoutError,
  RPCNetworkError,
  BindingRegistry,
  createCapabilityProxy,
  createAIBinding,
  createKVBinding,
  createR2Binding,
  createD1Binding,
  createToolBinding,
  createUnifiedBinding,
  generateRequestId,
  calculateBackoffDelay,
  isRetryableError,
  DEFAULT_RETRY_POLICY,
  type RPCRequest,
  type RPCResponse,
  type ServiceBinding,
  type MethodDefinition,
  type AICapabilityMethods,
  type KVCapabilityMethods,
  type RetryPolicy,
} from '../bindings'

// ============================================================================
// Mock Service Binding
// ============================================================================

const MOCK_BASE_URL = 'http://mock-service.local'

function createMockBinding(
  handler: (request: Request) => Promise<Response>
): ServiceBinding {
  return {
    fetch: async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
      let url = typeof input === 'string' ? input : input.url
      // Convert relative URLs to absolute for Request constructor
      if (url.startsWith('/')) {
        url = `${MOCK_BASE_URL}${url}`
      }
      const request = new Request(url, init)
      return handler(request)
    },
  }
}

function createSuccessBinding<T>(result: T): ServiceBinding {
  return createMockBinding(async (request) => {
    const body: RPCRequest = await request.json()
    const response: RPCResponse<T> = {
      id: body.id,
      result,
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function createErrorBinding(error: { code: string; message: string }): ServiceBinding {
  return createMockBinding(async (request) => {
    const body: RPCRequest = await request.json()
    const response: RPCResponse = {
      id: body.id,
      error: { code: error.code, message: error.message },
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Utility Functions', () => {
  describe('generateRequestId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateRequestId()
      const id2 = generateRequestId()

      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^rpc_\d+_[a-z0-9]+$/)
    })

    it('should start with rpc_ prefix', () => {
      const id = generateRequestId()
      expect(id.startsWith('rpc_')).toBe(true)
    })
  })

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff', () => {
      const policy: RetryPolicy = {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0,
      }

      expect(calculateBackoffDelay(0, policy)).toBe(100)
      expect(calculateBackoffDelay(1, policy)).toBe(200)
      expect(calculateBackoffDelay(2, policy)).toBe(400)
    })

    it('should respect maximum delay', () => {
      const policy: RetryPolicy = {
        maxAttempts: 10,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterFactor: 0,
      }

      const delay = calculateBackoffDelay(5, policy)
      expect(delay).toBe(5000)
    })

    it('should apply jitter within range', () => {
      const policy: RetryPolicy = {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 1,
        jitterFactor: 0.5,
      }

      // Run multiple times to test randomness
      const delays = Array.from({ length: 100 }, () =>
        calculateBackoffDelay(0, policy)
      )

      // All delays should be within jitter range
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(500)
        expect(delay).toBeLessThanOrEqual(1500)
      }
    })
  })

  describe('isRetryableError', () => {
    it('should return true for explicitly retryable errors', () => {
      const error = new RPCBindingError('Test', 'TIMEOUT', { retryable: true })
      expect(isRetryableError(error, DEFAULT_RETRY_POLICY)).toBe(true)
    })

    it('should return true for errors with retryable codes', () => {
      const error = new RPCBindingError('Test', 'SERVICE_UNAVAILABLE')
      expect(isRetryableError(error, DEFAULT_RETRY_POLICY)).toBe(true)
    })

    it('should return false for non-retryable errors', () => {
      const error = new RPCBindingError('Test', 'INVALID_PARAMS', { retryable: false })
      expect(isRetryableError(error, DEFAULT_RETRY_POLICY)).toBe(false)
    })

    it('should check numeric error codes', () => {
      const error = new RPCBindingError('Test', 503)
      expect(isRetryableError(error, DEFAULT_RETRY_POLICY)).toBe(true)
    })
  })
})

// ============================================================================
// RPCBindingError Tests
// ============================================================================

describe('RPCBindingError', () => {
  it('should create error with code and message', () => {
    const error = new RPCBindingError('Something failed', 'CUSTOM_ERROR')

    expect(error.message).toBe('Something failed')
    expect(error.code).toBe('CUSTOM_ERROR')
    expect(error.name).toBe('RPCBindingError')
  })

  it('should include optional data', () => {
    const error = new RPCBindingError('Failed', 'ERROR', {
      data: { field: 'test' },
    })

    expect(error.data).toEqual({ field: 'test' })
  })

  it('should track retryable status', () => {
    const retryableError = new RPCBindingError('Timeout', 'TIMEOUT', {
      retryable: true,
    })
    const nonRetryableError = new RPCBindingError('Invalid', 'INVALID', {
      retryable: false,
    })

    expect(retryableError.retryable).toBe(true)
    expect(nonRetryableError.retryable).toBe(false)
  })

  it('should create from RPC error', () => {
    const rpcError = {
      code: 'SERVER_ERROR',
      message: 'Internal error',
      data: { stack: 'trace' },
      retryable: true,
    }

    const error = RPCBindingError.fromRPCError(rpcError, 'req-123')

    expect(error.code).toBe('SERVER_ERROR')
    expect(error.message).toBe('Internal error')
    expect(error.data).toEqual({ stack: 'trace' })
    expect(error.retryable).toBe(true)
    expect(error.requestId).toBe('req-123')
  })

  it('should convert to RPC error', () => {
    const error = new RPCBindingError('Test error', 'TEST', {
      data: { info: 'data' },
      retryable: true,
    })

    const rpcError = error.toRPCError()

    expect(rpcError.code).toBe('TEST')
    expect(rpcError.message).toBe('Test error')
    expect(rpcError.data).toEqual({ info: 'data' })
    expect(rpcError.retryable).toBe(true)
  })
})

describe('RPCTimeoutError', () => {
  it('should create timeout error with method and duration', () => {
    const error = new RPCTimeoutError('ai.generate', 5000, 'req-1')

    expect(error.message).toContain('ai.generate')
    expect(error.message).toContain('5000ms')
    expect(error.code).toBe('TIMEOUT')
    expect(error.retryable).toBe(true)
    expect(error.name).toBe('RPCTimeoutError')
  })
})

describe('RPCNetworkError', () => {
  it('should create network error', () => {
    const error = new RPCNetworkError('Connection refused', 'req-1')

    expect(error.message).toBe('Connection refused')
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.retryable).toBe(true)
    expect(error.name).toBe('RPCNetworkError')
  })
})

// ============================================================================
// RPCBinding Tests
// ============================================================================

describe('RPCBinding', () => {
  describe('isAvailable', () => {
    it('should return true when binding is provided', () => {
      const binding = new RPCBinding(
        createSuccessBinding({ result: true }),
        { name: 'test' }
      )

      expect(binding.isAvailable()).toBe(true)
    })

    it('should return false when binding is null', () => {
      const binding = new RPCBinding(null, { name: 'test' })

      expect(binding.isAvailable()).toBe(false)
    })

    it('should return false when binding is undefined', () => {
      const binding = new RPCBinding(undefined, { name: 'test' })

      expect(binding.isAvailable()).toBe(false)
    })
  })

  describe('hasFallback', () => {
    it('should return true when fallback is provided', () => {
      const binding = new RPCBinding(
        null,
        { name: 'test' },
        async () => ({ result: true })
      )

      expect(binding.hasFallback()).toBe(true)
    })

    it('should return false when no fallback', () => {
      const binding = new RPCBinding(null, { name: 'test' })

      expect(binding.hasFallback()).toBe(false)
    })
  })

  describe('call', () => {
    it('should call method and return result', async () => {
      const mockBinding = createSuccessBinding({ text: 'Hello!' })
      const binding = new RPCBinding<AICapabilityMethods>(mockBinding, {
        name: 'ai',
      })

      const result = await binding.call('ai.generate', {
        prompt: 'Hi',
      })

      expect(result).toEqual({ text: 'Hello!' })
    })

    it('should include request ID in headers', async () => {
      let capturedRequest: Request | null = null
      const mockBinding = createMockBinding(async (request) => {
        capturedRequest = request
        return new Response(JSON.stringify({ id: '1', result: {} }), {
          status: 200,
        })
      })

      const binding = new RPCBinding(mockBinding, { name: 'test' })
      await binding.call('test.method', {})

      expect(capturedRequest?.headers.get('X-Request-ID')).toMatch(/^rpc_/)
    })

    it('should throw when binding unavailable and no fallback', async () => {
      const binding = new RPCBinding(null, { name: 'test' })

      await expect(binding.call('test.method', {})).rejects.toThrow(
        'Service binding \'test\' not available'
      )
    })

    it('should use fallback when binding unavailable', async () => {
      const fallback = vi.fn().mockResolvedValue({ fallback: true })
      const binding = new RPCBinding(null, { name: 'test' }, fallback)

      const result = await binding.call('test.method', { input: 'data' })

      expect(result).toEqual({ fallback: true })
      expect(fallback).toHaveBeenCalledWith('test.method', { input: 'data' })
    })

    it('should handle RPC error response', async () => {
      const mockBinding = createErrorBinding({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      })
      const binding = new RPCBinding(mockBinding, { name: 'test' })

      await expect(binding.call('test.method', {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      })
    })

    it('should handle HTTP error response', async () => {
      const mockBinding = createMockBinding(async () => {
        return new Response('Internal Server Error', { status: 500 })
      })
      const binding = new RPCBinding(mockBinding, { name: 'test' })

      await expect(binding.call('test.method', {})).rejects.toMatchObject({
        code: 500,
      })
    })

    it('should respect custom timeout', async () => {
      let receivedTimeout: number | undefined
      const mockBinding = createMockBinding(async (request) => {
        const body: RPCRequest = await request.json()
        receivedTimeout = body.timeout
        return new Response(JSON.stringify({ id: body.id, result: {} }), {
          status: 200,
        })
      })

      const binding = new RPCBinding(mockBinding, { name: 'test', timeout: 5000 })
      await binding.call('test.method', {}, { timeout: 10000 })

      expect(receivedTimeout).toBe(10000)
    })

    it('should pass metadata to request', async () => {
      let receivedMeta: Record<string, unknown> | undefined
      const mockBinding = createMockBinding(async (request) => {
        const body: RPCRequest = await request.json()
        receivedMeta = body.meta
        return new Response(JSON.stringify({ id: body.id, result: {} }), {
          status: 200,
        })
      })

      const binding = new RPCBinding(mockBinding, { name: 'test' })
      await binding.call('test.method', {}, { meta: { traceId: 'abc' } })

      expect(receivedMeta).toEqual({ traceId: 'abc' })
    })
  })

  describe('retry behavior', () => {
    it('should retry on retryable errors', async () => {
      let attempts = 0
      const mockBinding = createMockBinding(async (request) => {
        attempts++
        const body: RPCRequest = await request.json()

        if (attempts < 3) {
          return new Response(
            JSON.stringify({
              id: body.id,
              error: { code: 503, message: 'Service unavailable', retryable: true },
            }),
            { status: 200 }
          )
        }

        return new Response(JSON.stringify({ id: body.id, result: { success: true } }), {
          status: 200,
        })
      })

      const binding = new RPCBinding(mockBinding, {
        name: 'test',
        retry: { ...DEFAULT_RETRY_POLICY, baseDelayMs: 1 },
      })

      const result = await binding.call('test.method', {})

      expect(attempts).toBe(3)
      expect(result).toEqual({ success: true })
    })

    it('should not retry non-retryable errors', async () => {
      let attempts = 0
      const mockBinding = createMockBinding(async (request) => {
        attempts++
        const body: RPCRequest = await request.json()
        return new Response(
          JSON.stringify({
            id: body.id,
            error: { code: 'INVALID_PARAMS', message: 'Bad request', retryable: false },
          }),
          { status: 200 }
        )
      })

      const binding = new RPCBinding(mockBinding, {
        name: 'test',
        retry: { ...DEFAULT_RETRY_POLICY, baseDelayMs: 1 },
      })

      await expect(binding.call('test.method', {})).rejects.toThrow()
      expect(attempts).toBe(1)
    })

    it('should exhaust retry attempts', async () => {
      let attempts = 0
      const mockBinding = createMockBinding(async (request) => {
        attempts++
        const body: RPCRequest = await request.json()
        return new Response(
          JSON.stringify({
            id: body.id,
            error: { code: 'TIMEOUT', message: 'Timed out', retryable: true },
          }),
          { status: 200 }
        )
      })

      const binding = new RPCBinding(mockBinding, {
        name: 'test',
        retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3, baseDelayMs: 1 },
      })

      await expect(binding.call('test.method', {})).rejects.toThrow()
      expect(attempts).toBe(3)
    })
  })

  describe('streaming', () => {
    it('should stream chunks from response', async () => {
      const chunks = [
        { seq: 0, data: 'Hello', done: false },
        { seq: 1, data: ' world', done: false },
        { seq: 2, data: '!', done: true },
      ]

      const mockBinding = createMockBinding(async () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
            }
            controller.close()
          },
        })

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })

      const binding = new RPCBinding(mockBinding, { name: 'test' })
      const results: string[] = []

      for await (const chunk of binding.stream('test.stream', {})) {
        results.push(chunk as string)
      }

      expect(results).toEqual(['Hello', ' world', '!'])
    })

    it('should throw when streaming with unavailable binding', async () => {
      const binding = new RPCBinding(null, { name: 'test' })

      const generator = binding.stream('test.stream', {})

      await expect(generator.next()).rejects.toThrow('not available for streaming')
    })

    it('should handle [DONE] marker', async () => {
      const mockBinding = createMockBinding(async () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, data: 'test', done: false })}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        })

        return new Response(stream, { status: 200 })
      })

      const binding = new RPCBinding(mockBinding, { name: 'test' })
      const results: unknown[] = []

      for await (const chunk of binding.stream('test.stream', {})) {
        results.push(chunk)
      }

      expect(results).toEqual(['test'])
    })
  })
})

// ============================================================================
// Capability Module Binding Factory Tests
// ============================================================================

describe('Capability Binding Factories', () => {
  describe('createAIBinding', () => {
    it('should create AI binding with default timeout', () => {
      const mockBinding = createSuccessBinding({})
      const ai = createAIBinding(mockBinding)

      expect(ai.isAvailable()).toBe(true)
    })

    it('should handle null binding', () => {
      const ai = createAIBinding(null)
      expect(ai.isAvailable()).toBe(false)
    })
  })

  describe('createKVBinding', () => {
    it('should create KV binding', () => {
      const mockBinding = createSuccessBinding({})
      const kv = createKVBinding(mockBinding)

      expect(kv.isAvailable()).toBe(true)
    })
  })

  describe('createR2Binding', () => {
    it('should create R2 binding', () => {
      const mockBinding = createSuccessBinding({})
      const r2 = createR2Binding(mockBinding)

      expect(r2.isAvailable()).toBe(true)
    })
  })

  describe('createD1Binding', () => {
    it('should create D1 binding', () => {
      const mockBinding = createSuccessBinding({})
      const d1 = createD1Binding(mockBinding)

      expect(d1.isAvailable()).toBe(true)
    })
  })

  describe('createToolBinding', () => {
    it('should create tool binding', () => {
      const mockBinding = createSuccessBinding({})
      const tools = createToolBinding(mockBinding)

      expect(tools.isAvailable()).toBe(true)
    })
  })

  describe('createUnifiedBinding', () => {
    it('should create unified binding with all capabilities', () => {
      const mockBinding = createSuccessBinding({})
      const unified = createUnifiedBinding(mockBinding)

      expect(unified.isAvailable()).toBe(true)
    })
  })
})

// ============================================================================
// BindingRegistry Tests
// ============================================================================

describe('BindingRegistry', () => {
  let registry: BindingRegistry

  beforeEach(() => {
    registry = new BindingRegistry()
  })

  describe('register', () => {
    it('should register a binding', () => {
      const mockBinding = createSuccessBinding({})
      const ai = createAIBinding(mockBinding)

      registry.register('ai', ai)

      expect(registry.get('ai')).toBe(ai)
    })
  })

  describe('has', () => {
    it('should return true for available registered binding', () => {
      const mockBinding = createSuccessBinding({})
      registry.register('ai', createAIBinding(mockBinding))

      expect(registry.has('ai')).toBe(true)
    })

    it('should return false for unavailable binding', () => {
      registry.register('ai', createAIBinding(null))

      expect(registry.has('ai')).toBe(false)
    })

    it('should return false for unregistered binding', () => {
      expect(registry.has('unknown')).toBe(false)
    })
  })

  describe('list', () => {
    it('should list all registered bindings', () => {
      registry.register('ai', createAIBinding(null))
      registry.register('kv', createKVBinding(null))

      expect(registry.list()).toContain('ai')
      expect(registry.list()).toContain('kv')
    })
  })

  describe('listAvailable', () => {
    it('should list only available bindings', () => {
      const mockBinding = createSuccessBinding({})
      registry.register('ai', createAIBinding(mockBinding))
      registry.register('kv', createKVBinding(null))

      expect(registry.listAvailable()).toEqual(['ai'])
    })
  })

  describe('call', () => {
    it('should route call to correct binding by prefix', async () => {
      const mockBinding = createSuccessBinding({ text: 'response' })
      registry.register('ai', createAIBinding(mockBinding))

      const result = await registry.call('ai.generate', { prompt: 'test' })

      expect(result).toEqual({ text: 'response' })
    })

    it('should use fallback when binding unavailable', async () => {
      registry.register('ai', createAIBinding(null))
      registry.registerFallback('ai', async () => ({ fallback: true }))

      const result = await registry.call('ai.generate', { prompt: 'test' })

      expect(result).toEqual({ fallback: true })
    })

    it('should throw when no binding or fallback', async () => {
      await expect(
        registry.call('unknown.method', {})
      ).rejects.toThrow('No binding or fallback available')
    })
  })
})

// ============================================================================
// Capability Proxy Tests
// ============================================================================

describe('createCapabilityProxy', () => {
  it('should use binding when available', async () => {
    const mockBinding = createSuccessBinding({ text: 'from binding' })

    const proxy = createCapabilityProxy<AICapabilityMethods>({
      binding: mockBinding,
      fallback: {
        'ai.generate': async () => ({ text: 'from fallback', usage: undefined }),
      },
    })

    const result = await proxy.call('ai.generate', { prompt: 'test' })

    expect(result).toEqual({ text: 'from binding' })
  })

  it('should use fallback when binding unavailable', async () => {
    const proxy = createCapabilityProxy<AICapabilityMethods>({
      binding: null,
      fallback: {
        'ai.generate': async (params) => ({
          text: `Generated: ${params.prompt}`,
          usage: undefined,
        }),
      },
    })

    const result = await proxy.call('ai.generate', { prompt: 'hello' })

    expect(result).toEqual({ text: 'Generated: hello', usage: undefined })
  })

  it('should throw when no fallback for method', async () => {
    const proxy = createCapabilityProxy<AICapabilityMethods>({
      binding: null,
      fallback: {
        'ai.generate': async () => ({ text: 'ok', usage: undefined }),
      },
    })

    await expect(
      proxy.call('ai.embed', { text: 'test' })
    ).rejects.toThrow('No fallback implementation')
  })

  it('should work without any fallback', async () => {
    const mockBinding = createSuccessBinding({ success: true })

    const proxy = createCapabilityProxy({
      binding: mockBinding,
    })

    const result = await proxy.call('any.method', {})

    expect(result).toEqual({ success: true })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  it('should handle complete AI workflow', async () => {
    // Mock AI service that returns generated text
    const aiBinding = createMockBinding(async (request) => {
      const body: RPCRequest = await request.json()

      if (body.method === 'ai.generate') {
        const params = body.params as { prompt: string }
        return new Response(
          JSON.stringify({
            id: body.id,
            result: {
              text: `AI response to: ${params.prompt}`,
              usage: { promptTokens: 10, completionTokens: 20 },
            },
          }),
          { status: 200 }
        )
      }

      if (body.method === 'ai.embed') {
        return new Response(
          JSON.stringify({
            id: body.id,
            result: {
              embeddings: [[0.1, 0.2, 0.3]],
              dimension: 3,
            },
          }),
          { status: 200 }
        )
      }

      return new Response(
        JSON.stringify({
          id: body.id,
          error: { code: 'METHOD_NOT_FOUND', message: 'Unknown method' },
        }),
        { status: 200 }
      )
    })

    const ai = createAIBinding(aiBinding)

    // Test text generation
    const genResult = await ai.call('ai.generate', { prompt: 'Hello' })
    expect(genResult).toMatchObject({
      text: 'AI response to: Hello',
      usage: { promptTokens: 10, completionTokens: 20 },
    })

    // Test embedding
    const embedResult = await ai.call('ai.embed', { text: 'test' })
    expect(embedResult).toMatchObject({
      embeddings: [[0.1, 0.2, 0.3]],
      dimension: 3,
    })
  })

  it('should handle KV operations', async () => {
    const store = new Map<string, unknown>()

    const kvBinding = createMockBinding(async (request) => {
      const body: RPCRequest = await request.json()
      const params = body.params as { key: string; value?: unknown }

      switch (body.method) {
        case 'kv.get':
          return new Response(
            JSON.stringify({
              id: body.id,
              result: store.has(params.key)
                ? { value: store.get(params.key) }
                : null,
            }),
            { status: 200 }
          )

        case 'kv.set':
          store.set(params.key, params.value)
          return new Response(
            JSON.stringify({
              id: body.id,
              result: { success: true },
            }),
            { status: 200 }
          )

        default:
          return new Response(
            JSON.stringify({
              id: body.id,
              error: { code: 'METHOD_NOT_FOUND', message: 'Unknown method' },
            }),
            { status: 200 }
          )
      }
    })

    const kv = createKVBinding(kvBinding)

    // Set value
    await kv.call('kv.set', { key: 'user:123', value: { name: 'Alice' } })

    // Get value
    const result = await kv.call('kv.get', { key: 'user:123' })
    expect(result).toEqual({ value: { name: 'Alice' } })

    // Get non-existent key
    const missing = await kv.call('kv.get', { key: 'missing' })
    expect(missing).toBeNull()
  })

  it('should handle tool operations with fallback', async () => {
    // Tool service unavailable, use fallback
    interface LocalToolMethods {
      'tool.jq': MethodDefinition<
        { input: unknown; filter: string },
        { output: unknown }
      >
    }

    const tools = createCapabilityProxy<LocalToolMethods>({
      binding: null, // Service not deployed
      fallback: {
        'tool.jq': async (params) => {
          // Simple inline jq implementation for basic filters
          const { input, filter } = params
          if (filter === '.') {
            return { output: input }
          }
          if (filter.startsWith('.')) {
            const key = filter.slice(1)
            return { output: (input as Record<string, unknown>)[key] }
          }
          throw new Error('Unsupported filter')
        },
      },
    })

    // Should use fallback
    const result = await tools.call('tool.jq', {
      input: { name: 'test', value: 42 },
      filter: '.name',
    })

    expect(result).toEqual({ output: 'test' })
  })
})
