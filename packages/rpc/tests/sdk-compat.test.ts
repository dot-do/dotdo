/**
 * @dotdo/rpc - SDK Compatibility Layer Tests
 *
 * Phase 4: Streaming support, EventEmitter conversion, custom serializers,
 * and SDK compatibility registry for OpenAI, Anthropic, and other SDKs.
 *
 * TDD RED phase: Write failing tests first, then implement.
 *
 * @module @dotdo/rpc/tests/sdk-compat
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  StreamingExecutor,
  StreamChunk,
  StreamingConfig,
  EventEmitterBridge,
  EventHandler,
  EventConfig,
  CustomSerializer,
  SerializerRegistry,
  SDKCompatRegistry,
  SDKConfig,
  createSDKProxy,
  type SDKRuntime,
} from '../src/sdk-compat.js'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a mock ReadableStream for testing streaming responses
 */
function createMockStream<T>(chunks: T[]): ReadableStream<T> {
  let index = 0
  return new ReadableStream<T>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
      } else {
        controller.close()
      }
    },
  })
}

/**
 * Creates a mock SSE response for testing
 */
function createMockSSEResponse(events: Array<{ data: string; event?: string }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const lines = events.flatMap((e) => [
    e.event ? `event: ${e.event}` : null,
    `data: ${e.data}`,
    '',
  ]).filter(Boolean).join('\n') + '\n'

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines))
      controller.close()
    },
  })
}

// =============================================================================
// Streaming Support Tests
// =============================================================================
describe('@dotdo/rpc - Streaming Support', () => {
  describe('StreamingExecutor', () => {
    it('should create a streaming executor with SSE mode', () => {
      const config: StreamingConfig = {
        methods: ['chat.completions.create'],
        mode: 'sse',
      }

      const executor = new StreamingExecutor(config)
      expect(executor).toBeDefined()
      expect(executor.isStreamingMethod(['chat', 'completions', 'create'])).toBe(true)
      expect(executor.isStreamingMethod(['users', 'list'])).toBe(false)
    })

    it('should detect streaming methods with regex patterns', () => {
      const config: StreamingConfig = {
        methods: /\.stream$/,
        mode: 'sse',
      }

      const executor = new StreamingExecutor(config)
      expect(executor.isStreamingMethod(['messages', 'stream'])).toBe(true)
      expect(executor.isStreamingMethod(['messages', 'create'])).toBe(false)
    })

    it('should parse SSE stream into async iterator', async () => {
      const sseData = [
        { data: '{"id":"1","content":"Hello"}' },
        { data: '{"id":"2","content":" World"}' },
        { data: '[DONE]' },
      ]

      const mockResponse = new Response(createMockSSEResponse(sseData), {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const config: StreamingConfig = {
        methods: ['stream'],
        mode: 'sse',
      }

      const executor = new StreamingExecutor(config)
      const chunks: StreamChunk[] = []

      for await (const chunk of executor.parseSSE(mockResponse)) {
        if (chunk.done) break
        chunks.push(chunk)
      }

      expect(chunks).toHaveLength(2)
      expect(chunks[0].data).toEqual({ id: '1', content: 'Hello' })
      expect(chunks[1].data).toEqual({ id: '2', content: ' World' })
    })

    it('should handle OpenAI chat completions streaming format', async () => {
      const openAIChunks = [
        { data: '{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}' },
        { data: '{"id":"chatcmpl-1","choices":[{"delta":{"content":" there"}}]}' },
        { data: '{"id":"chatcmpl-1","choices":[{"finish_reason":"stop"}]}' },
        { data: '[DONE]' },
      ]

      const mockResponse = new Response(createMockSSEResponse(openAIChunks), {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const config: StreamingConfig = {
        methods: ['chat.completions.create'],
        mode: 'sse',
        parser: 'openai',
      }

      const executor = new StreamingExecutor(config)
      const content: string[] = []

      for await (const chunk of executor.parseOpenAIStream(mockResponse)) {
        if (chunk.done) break
        const delta = chunk.data?.choices?.[0]?.delta?.content
        if (delta) content.push(delta)
      }

      expect(content.join('')).toBe('Hello there')
    })

    it('should handle Anthropic messages streaming format', async () => {
      const anthropicEvents = [
        { event: 'message_start', data: '{"type":"message_start","message":{"id":"msg_1"}}' },
        { event: 'content_block_start', data: '{"type":"content_block_start","index":0}' },
        { event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"text":"Hello"}}' },
        { event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"text":" World"}}' },
        { event: 'content_block_stop', data: '{"type":"content_block_stop"}' },
        { event: 'message_stop', data: '{"type":"message_stop"}' },
      ]

      const mockResponse = new Response(createMockSSEResponse(anthropicEvents), {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const config: StreamingConfig = {
        methods: ['messages.create'],
        mode: 'sse',
        parser: 'anthropic',
      }

      const executor = new StreamingExecutor(config)
      const content: string[] = []

      for await (const chunk of executor.parseAnthropicStream(mockResponse)) {
        if (chunk.type === 'content_block_delta') {
          content.push(chunk.delta.text)
        }
      }

      expect(content.join('')).toBe('Hello World')
    })

    it('should support WebSocket mode for bidirectional streaming', async () => {
      const config: StreamingConfig = {
        methods: ['realtime.connect'],
        mode: 'websocket',
      }

      const executor = new StreamingExecutor(config)
      expect(executor.mode).toBe('websocket')

      // Mock WebSocket connection
      const mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1, // OPEN
      }

      const stream = executor.createWebSocketStream(mockWs as unknown as WebSocket)
      expect(stream).toBeDefined()
    })

    it('should convert streaming response to ReadableStream for Response', async () => {
      const sseData = [
        { data: '{"content":"chunk1"}' },
        { data: '{"content":"chunk2"}' },
        { data: '[DONE]' },
      ]

      const mockResponse = new Response(createMockSSEResponse(sseData), {
        headers: { 'Content-Type': 'text/event-stream' },
      })

      const config: StreamingConfig = {
        methods: ['stream'],
        mode: 'sse',
      }

      const executor = new StreamingExecutor(config)
      const readableStream = await executor.toReadableStream(mockResponse)

      expect(readableStream).toBeInstanceOf(ReadableStream)

      // Verify stream can be used in Response
      const response = new Response(readableStream, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
      expect(response.body).toBeDefined()
    })
  })

  describe('Streaming with RPC Proxy', () => {
    it('should detect and handle streaming calls in proxy', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          createMockSSEResponse([
            { data: '{"id":"1","content":"Hello"}' },
            { data: '[DONE]' },
          ]),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      )

      interface ChatAPI {
        chat: {
          completions: {
            create(params: { model: string; messages: unknown[]; stream?: boolean }): AsyncIterable<unknown>
          }
        }
      }

      const config: SDKConfig = {
        runtime: 'worker',
        streaming: {
          methods: ['chat.completions.create'],
          mode: 'sse',
        },
      }

      const proxy = createSDKProxy<ChatAPI>(
        { fetch: mockFetch, baseURL: 'https://api.openai.com' },
        config
      )

      const stream = proxy.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      const chunks: unknown[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// EventEmitter Bridge Tests
// =============================================================================
describe('@dotdo/rpc - EventEmitter Bridge', () => {
  describe('EventEmitterBridge', () => {
    it('should create a bridge from EventEmitter to edge-compatible handlers', () => {
      const config: EventConfig = {
        'message': 'websocket',
        'error': 'queue',
        'disconnect': (handler) => {
          // Custom handler
        },
      }

      const bridge = new EventEmitterBridge(config)
      expect(bridge).toBeDefined()
      expect(bridge.getRouting('message')).toBe('websocket')
      expect(bridge.getRouting('error')).toBe('queue')
      expect(typeof bridge.getRouting('disconnect')).toBe('function')
    })

    it('should convert on() calls to WebSocket subscriptions', async () => {
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn(),
        readyState: 1,
      }

      const config: EventConfig = {
        'data': 'websocket',
      }

      const bridge = new EventEmitterBridge(config)
      bridge.setWebSocket(mockWs as unknown as WebSocket)

      const handler: EventHandler = vi.fn()
      bridge.on('data', handler)

      // Should subscribe via WebSocket
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"subscribe":"data"')
      )

      // Simulate incoming message
      const messageHandler = mockWs.addEventListener.mock.calls.find(
        (call) => call[0] === 'message'
      )?.[1]

      messageHandler?.({ data: JSON.stringify({ type: 'data', payload: { value: 42 } }) })

      expect(handler).toHaveBeenCalledWith({ value: 42 })
    })

    it('should convert on() calls to Queue consumer', async () => {
      const mockQueue = {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      }

      const config: EventConfig = {
        'job': 'queue',
      }

      const bridge = new EventEmitterBridge(config)
      bridge.setQueue(mockQueue as unknown as { subscribe: (event: string, handler: EventHandler) => void })

      const handler: EventHandler = vi.fn()
      bridge.on('job', handler)

      expect(mockQueue.subscribe).toHaveBeenCalledWith('job', expect.any(Function))
    })

    it('should support removing event listeners', () => {
      const mockWs = {
        send: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        readyState: 1,
      }

      const config: EventConfig = {
        'data': 'websocket',
      }

      const bridge = new EventEmitterBridge(config)
      bridge.setWebSocket(mockWs as unknown as WebSocket)

      const handler: EventHandler = vi.fn()
      bridge.on('data', handler)
      bridge.off('data', handler)

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"unsubscribe":"data"')
      )
    })

    it('should emit events to all registered handlers', () => {
      const config: EventConfig = {}

      const bridge = new EventEmitterBridge(config)

      const handler1: EventHandler = vi.fn()
      const handler2: EventHandler = vi.fn()

      bridge.on('custom', handler1)
      bridge.on('custom', handler2)

      bridge.emit('custom', { payload: 'test' })

      expect(handler1).toHaveBeenCalledWith({ payload: 'test' })
      expect(handler2).toHaveBeenCalledWith({ payload: 'test' })
    })

    it('should support once() for single-fire handlers', async () => {
      const config: EventConfig = {}

      const bridge = new EventEmitterBridge(config)

      const handler: EventHandler = vi.fn()
      bridge.once('event', handler)

      bridge.emit('event', { first: true })
      bridge.emit('event', { second: true })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ first: true })
    })

    it('should handle wildcard event subscriptions', () => {
      const config: EventConfig = {
        '*': 'websocket',
      }

      const bridge = new EventEmitterBridge(config)
      expect(bridge.getRouting('anyEvent')).toBe('websocket')
      expect(bridge.getRouting('anotherEvent')).toBe('websocket')
    })
  })

  describe('EventEmitter SDK Integration', () => {
    it('should wrap EventEmitter-based SDK methods', async () => {
      // Mock Kafka-like SDK
      interface KafkaConsumer {
        on(event: 'message', handler: (msg: unknown) => void): void
        on(event: 'error', handler: (err: Error) => void): void
        subscribe(topics: string[]): Promise<void>
        run(): Promise<void>
      }

      const config: SDKConfig = {
        runtime: 'container',
        events: {
          'message': 'queue',
          'error': 'websocket',
        },
      }

      // The proxy should intercept on() calls and route them appropriately
      const mockConsumer: KafkaConsumer = {
        on: vi.fn(),
        subscribe: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockResolvedValue(undefined),
      }

      // SDK proxy should wrap the consumer
      const wrappedConsumer = createSDKProxy<KafkaConsumer>(mockConsumer, config)

      const messageHandler = vi.fn()
      wrappedConsumer.on('message', messageHandler)

      // The on() call should be intercepted
      expect(mockConsumer.on).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Custom Serializer Tests
// =============================================================================
describe('@dotdo/rpc - Custom Serializers', () => {
  describe('SerializerRegistry', () => {
    it('should register custom serializers for SDK-specific types', () => {
      const registry = new SerializerRegistry()

      // Register a custom serializer for Stripe's Address type
      const addressSerializer: CustomSerializer = {
        name: 'StripeAddress',
        test: (value) =>
          typeof value === 'object' &&
          value !== null &&
          'line1' in value &&
          'city' in value,
        serialize: (value) => ({
          __rpc_type__: 'StripeAddress',
          value: {
            line1: value.line1,
            line2: value.line2,
            city: value.city,
            state: value.state,
            postal_code: value.postal_code,
            country: value.country,
          },
        }),
        deserialize: (data) => ({
          line1: data.value.line1,
          line2: data.value.line2,
          city: data.value.city,
          state: data.value.state,
          postal_code: data.value.postal_code,
          country: data.value.country,
        }),
      }

      registry.register(addressSerializer)

      const address = {
        line1: '123 Main St',
        line2: 'Apt 4',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94102',
        country: 'US',
      }

      const serialized = registry.serialize(address)
      expect(serialized.__rpc_type__).toBe('StripeAddress')

      const deserialized = registry.deserialize(serialized)
      expect(deserialized).toEqual(address)
    })

    it('should handle OpenAI message format', () => {
      const registry = new SerializerRegistry()

      // OpenAI ChatCompletionMessage serializer
      const messageSerializer: CustomSerializer = {
        name: 'OpenAIChatMessage',
        test: (value) =>
          typeof value === 'object' &&
          value !== null &&
          'role' in value &&
          ('content' in value || 'tool_calls' in value),
        serialize: (value) => ({
          __rpc_type__: 'OpenAIChatMessage',
          value: {
            role: value.role,
            content: value.content,
            name: value.name,
            tool_calls: value.tool_calls,
            tool_call_id: value.tool_call_id,
          },
        }),
        deserialize: (data) => data.value,
      }

      registry.register(messageSerializer)

      const message = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"location":"SF"}' },
          },
        ],
      }

      const serialized = registry.serialize(message)
      expect(serialized.__rpc_type__).toBe('OpenAIChatMessage')

      const deserialized = registry.deserialize(serialized)
      expect(deserialized.tool_calls).toHaveLength(1)
    })

    it('should handle Anthropic content blocks', () => {
      const registry = new SerializerRegistry()

      const contentBlockSerializer: CustomSerializer = {
        name: 'AnthropicContentBlock',
        test: (value) =>
          typeof value === 'object' &&
          value !== null &&
          'type' in value &&
          (value.type === 'text' || value.type === 'tool_use' || value.type === 'tool_result'),
        serialize: (value) => ({
          __rpc_type__: 'AnthropicContentBlock',
          value,
        }),
        deserialize: (data) => data.value,
      }

      registry.register(contentBlockSerializer)

      const toolUseBlock = {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'search',
        input: { query: 'test' },
      }

      const serialized = registry.serialize(toolUseBlock)
      expect(serialized.__rpc_type__).toBe('AnthropicContentBlock')
    })

    it('should fallback to default serialization for unknown types', () => {
      const registry = new SerializerRegistry()

      const unknownObject = {
        custom: 'value',
        nested: { data: 123 },
      }

      const serialized = registry.serialize(unknownObject)
      // Should not have custom type marker
      expect(serialized.__rpc_type__).toBeUndefined()
      expect(serialized).toEqual(unknownObject)
    })

    it('should compose multiple serializers', () => {
      const registry = new SerializerRegistry()

      // Register multiple serializers
      registry.register({
        name: 'TypeA',
        test: (v) => v?.typeMarker === 'A',
        serialize: (v) => ({ __rpc_type__: 'TypeA', value: v }),
        deserialize: (d) => d.value,
      })

      registry.register({
        name: 'TypeB',
        test: (v) => v?.typeMarker === 'B',
        serialize: (v) => ({ __rpc_type__: 'TypeB', value: v }),
        deserialize: (d) => d.value,
      })

      const objA = { typeMarker: 'A', data: 1 }
      const objB = { typeMarker: 'B', data: 2 }

      expect(registry.serialize(objA).__rpc_type__).toBe('TypeA')
      expect(registry.serialize(objB).__rpc_type__).toBe('TypeB')
    })

    it('should handle arrays with mixed types', () => {
      const registry = new SerializerRegistry()

      registry.register({
        name: 'SpecialDate',
        test: (v) => v instanceof Date,
        serialize: (v) => ({ __rpc_type__: 'SpecialDate', value: v.toISOString() }),
        deserialize: (d) => new Date(d.value),
      })

      const mixed = [
        new Date('2024-01-01'),
        'string',
        123,
        new Date('2024-12-31'),
      ]

      const serialized = registry.serializeArray(mixed)
      expect(serialized[0].__rpc_type__).toBe('SpecialDate')
      expect(serialized[1]).toBe('string')
      expect(serialized[2]).toBe(123)
      expect(serialized[3].__rpc_type__).toBe('SpecialDate')

      const deserialized = registry.deserializeArray(serialized)
      expect(deserialized[0]).toBeInstanceOf(Date)
      expect(deserialized[3]).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// SDK Compatibility Registry Tests
// =============================================================================
describe('@dotdo/rpc - SDK Compatibility Registry', () => {
  describe('SDKCompatRegistry', () => {
    it('should have pre-configured settings for common SDKs', () => {
      const registry = new SDKCompatRegistry()

      // OpenAI
      const openaiConfig = registry.get('openai')
      expect(openaiConfig).toBeDefined()
      expect(openaiConfig?.runtime).toBe('worker')
      expect(openaiConfig?.streaming?.methods).toContain('chat.completions.create')

      // Anthropic
      const anthropicConfig = registry.get('@anthropic-ai/sdk')
      expect(anthropicConfig).toBeDefined()
      expect(anthropicConfig?.runtime).toBe('worker')
      expect(anthropicConfig?.streaming?.methods).toContain('messages.create')

      // Stripe
      const stripeConfig = registry.get('stripe')
      expect(stripeConfig).toBeDefined()
      expect(stripeConfig?.runtime).toBe('worker')
    })

    it('should identify SDKs requiring container runtime', () => {
      const registry = new SDKCompatRegistry()

      // Native extension SDKs
      expect(registry.get('sharp')?.runtime).toBe('container')
      expect(registry.get('better-sqlite3')?.runtime).toBe('container')
      expect(registry.get('canvas')?.runtime).toBe('container')
      expect(registry.get('puppeteer')?.runtime).toBe('container')
    })

    it('should identify SDKs with event-based patterns', () => {
      const registry = new SDKCompatRegistry()

      // Kafka
      const kafkaConfig = registry.get('kafkajs')
      expect(kafkaConfig?.runtime).toBe('container')
      expect(kafkaConfig?.events).toBeDefined()
      expect(kafkaConfig?.events?.['consumer.message']).toBe('queue')
    })

    it('should allow custom SDK registration', () => {
      const registry = new SDKCompatRegistry()

      registry.register('my-custom-sdk', {
        runtime: 'worker',
        streaming: {
          methods: ['stream'],
          mode: 'sse',
        },
      })

      const config = registry.get('my-custom-sdk')
      expect(config).toBeDefined()
      expect(config?.runtime).toBe('worker')
    })

    it('should merge custom config with defaults', () => {
      const registry = new SDKCompatRegistry()

      // Override default OpenAI config
      registry.extend('openai', {
        streaming: {
          methods: ['chat.completions.create', 'audio.speech.create'],
          mode: 'sse',
        },
      })

      const config = registry.get('openai')
      expect(config?.streaming?.methods).toContain('audio.speech.create')
    })

    it('should detect SDK from package name', () => {
      const registry = new SDKCompatRegistry()

      // Exact match
      expect(registry.detect('openai')).toBe('openai')

      // Scoped packages
      expect(registry.detect('@anthropic-ai/sdk')).toBe('@anthropic-ai/sdk')

      // Unknown SDK
      expect(registry.detect('unknown-package')).toBeNull()
    })

    it('should provide runtime detection hints', () => {
      const registry = new SDKCompatRegistry()

      // Check if SDK needs native runtime
      expect(registry.needsContainer('sharp')).toBe(true)
      expect(registry.needsContainer('openai')).toBe(false)

      // Check if SDK has streaming
      expect(registry.hasStreaming('openai')).toBe(true)
      expect(registry.hasStreaming('stripe')).toBe(false)

      // Check if SDK has events
      expect(registry.hasEvents('kafkajs')).toBe(true)
      expect(registry.hasEvents('openai')).toBe(false)
    })
  })

  describe('SDK Proxy Factory', () => {
    it('should create proxy with auto-detected config', () => {
      const mockSDK = {
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
      }

      const proxy = createSDKProxy(mockSDK, { sdkName: 'openai' })

      expect(proxy.chat.completions.create).toBeDefined()
    })

    it('should apply streaming config to relevant methods', async () => {
      const mockResponse = new Response(
        createMockSSEResponse([
          { data: '{"id":"1","choices":[{"delta":{"content":"Hi"}}]}' },
          { data: '[DONE]' },
        ]),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )

      const mockSDK = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockResponse),
          },
        },
      }

      const proxy = createSDKProxy(mockSDK, {
        sdkName: 'openai',
        streaming: {
          methods: ['chat.completions.create'],
          mode: 'sse',
        },
      })

      const result = await proxy.chat.completions.create({
        model: 'gpt-4',
        messages: [],
        stream: true,
      })

      // When stream: true, should return async iterator
      expect(result[Symbol.asyncIterator]).toBeDefined()
    })

    it('should apply event bridge to EventEmitter methods', () => {
      const mockSDK = {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
      }

      const proxy = createSDKProxy(mockSDK, {
        sdkName: 'custom',
        events: {
          'message': 'websocket',
          'error': 'queue',
        },
      })

      const handler = () => {}
      proxy.on('message', handler)

      // Should still call original method
      expect(mockSDK.on).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('should apply custom serializers to method arguments and results', async () => {
      const customDate = new Date('2024-06-15')

      const mockSDK = {
        createEvent: vi.fn().mockResolvedValue({
          id: 'evt_123',
          created: customDate,
        }),
      }

      const customSerializer: CustomSerializer = {
        name: 'CustomDate',
        test: (v) => v instanceof Date,
        serialize: (v) => ({ __rpc_type__: 'CustomDate', value: v.toISOString() }),
        deserialize: (d) => new Date(d.value),
      }

      const proxy = createSDKProxy(mockSDK, {
        serializers: [customSerializer],
      })

      const result = await proxy.createEvent({ date: customDate })

      expect(result.created).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================
describe('@dotdo/rpc - SDK Compat Integration', () => {
  it('should work end-to-end with OpenAI-like streaming', async () => {
    // Simulate OpenAI SDK behavior
    const openAIChunks = [
      { id: 'chatcmpl-1', choices: [{ delta: { content: 'Hello' } }] },
      { id: 'chatcmpl-1', choices: [{ delta: { content: ' World' } }] },
      { id: 'chatcmpl-1', choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        createMockSSEResponse(
          openAIChunks.map((c) => ({ data: JSON.stringify(c) })).concat([{ data: '[DONE]' }])
        ),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
    )

    interface OpenAILike {
      chat: {
        completions: {
          create(params: { model: string; messages: unknown[]; stream?: boolean }): Promise<unknown>
        }
      }
    }

    const mockOpenAI: OpenAILike = {
      chat: {
        completions: {
          create: async (params) => {
            const response = await mockFetch('/chat/completions', {
              method: 'POST',
              body: JSON.stringify(params),
            })
            return response
          },
        },
      },
    }

    const proxy = createSDKProxy(mockOpenAI, {
      sdkName: 'openai',
      streaming: {
        methods: ['chat.completions.create'],
        mode: 'sse',
        parser: 'openai',
      },
    })

    const stream = await proxy.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Say hi' }],
      stream: true,
    })

    const content: string[] = []
    for await (const chunk of stream as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>) {
      const c = chunk.choices[0]?.delta?.content
      if (c) content.push(c)
    }

    expect(content.join('')).toBe('Hello World')
  })

  it('should work end-to-end with Anthropic-like streaming', async () => {
    const anthropicEvents = [
      { event: 'message_start', data: '{"type":"message_start","message":{"id":"msg_1"}}' },
      { event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}' },
      { event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}' },
      { event: 'message_stop', data: '{"type":"message_stop"}' },
    ]

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(createMockSSEResponse(anthropicEvents), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    interface AnthropicLike {
      messages: {
        create(params: { model: string; messages: unknown[]; stream?: boolean }): Promise<unknown>
      }
    }

    const mockAnthropic: AnthropicLike = {
      messages: {
        create: async (params) => {
          return await mockFetch('/messages', {
            method: 'POST',
            body: JSON.stringify(params),
          })
        },
      },
    }

    const proxy = createSDKProxy(mockAnthropic, {
      sdkName: '@anthropic-ai/sdk',
      streaming: {
        methods: ['messages.create'],
        mode: 'sse',
        parser: 'anthropic',
      },
    })

    const stream = await proxy.messages.create({
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Say hi' }],
      stream: true,
    })

    const content: string[] = []
    for await (const chunk of stream as AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        content.push(chunk.delta.text)
      }
    }

    expect(content.join('')).toBe('Hello there')
  })
})
