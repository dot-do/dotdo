// Transport Factory Functions Tests
// Tests for convenience functions that create transport instances

import { describe, it, expect, vi } from 'vitest'

// ============================================================================
// createFetchTransport Tests
// ============================================================================

describe('createFetchTransport', () => {
  it('should create a FetchTransport instance', async () => {
    const { createFetchTransport, FetchTransport } = await import('../transport/fetch')

    const transport = createFetchTransport({
      url: 'https://api.example.com',
    })

    expect(transport).toBeInstanceOf(FetchTransport)
    expect(typeof transport.send).toBe('function')
    expect(typeof transport.close).toBe('function')
    expect(typeof transport.getState).toBe('function')
  })

  it('should pass all options to FetchTransport constructor', async () => {
    const { createFetchTransport } = await import('../transport/fetch')
    const { CORRELATION_ID_HEADER } = await import('../headers')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'ok' }),
      headers: new Headers(),
    })

    const transport = createFetchTransport({
      url: 'https://api.example.com',
      timeout: 5000,
      correlationId: 'base-id',
      headers: { 'X-Custom': 'value' },
      fetch: mockFetch,
      validateMessages: true,
    })

    // Send a valid message to verify options are passed
    await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/rpc',
      expect.objectContaining({
        headers: expect.objectContaining({
          [CORRELATION_ID_HEADER]: 'base-id',
          'X-Custom': 'value',
        }),
      })
    )
  })

  it('should be equivalent to new FetchTransport()', async () => {
    const { createFetchTransport, FetchTransport } = await import('../transport/fetch')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
      headers: new Headers(),
    })

    const options = {
      url: 'https://api.example.com',
      fetch: mockFetch,
    }

    const factoryTransport = createFetchTransport(options)
    const directTransport = new FetchTransport(options)

    // Both should be FetchTransport instances
    expect(factoryTransport).toBeInstanceOf(FetchTransport)
    expect(directTransport).toBeInstanceOf(FetchTransport)

    // Both should behave identically
    const factoryResult = await factoryTransport.send({ method: 'test', args: [] })
    const directResult = await directTransport.send({ method: 'test', args: [] })

    expect(factoryResult.result).toEqual(directResult.result)
  })
})

// ============================================================================
// createWebSocketTransport Tests
// ============================================================================

describe('createWebSocketTransport', () => {
  // Mock WebSocket for testing
  class MockWebSocket {
    static OPEN = 1
    static CLOSED = 3

    url: string
    readyState = MockWebSocket.OPEN
    listeners: Record<string, Function[]> = {}

    constructor(url: string) {
      this.url = url
      setTimeout(() => this.emit('open', {}), 0)
    }

    addEventListener(event: string, handler: Function) {
      if (!this.listeners[event]) {
        this.listeners[event] = []
      }
      this.listeners[event].push(handler)
    }

    removeEventListener(event: string, handler: Function) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
      }
    }

    emit(event: string, data: unknown) {
      if (this.listeners[event]) {
        this.listeners[event].forEach((h) => h(data))
      }
    }

    send(data: string) {
      const message = JSON.parse(data)
      setTimeout(() => {
        this.emit('message', {
          data: JSON.stringify({
            id: message.id,
            result: { echo: message.method },
          }),
        })
      }, 5)
    }

    close() {
      this.readyState = MockWebSocket.CLOSED
      this.emit('close', {})
    }
  }

  it('should create a WebSocketTransport instance', async () => {
    const { createWebSocketTransport, WebSocketTransport } = await import('../transport/websocket')

    const transport = createWebSocketTransport({
      url: 'wss://api.example.com/ws',
      WebSocket: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    })

    expect(transport).toBeInstanceOf(WebSocketTransport)
    expect(typeof transport.send).toBe('function')
    expect(typeof transport.close).toBe('function')
    expect(typeof transport.getState).toBe('function')
    expect(typeof transport.addEventListener).toBe('function')

    await transport.close()
  })

  it('should pass all options to WebSocketTransport constructor', async () => {
    const { createWebSocketTransport } = await import('../transport/websocket')
    const { TransportState } = await import('../transport/types')

    const transport = createWebSocketTransport({
      url: 'wss://api.example.com/ws',
      WebSocket: MockWebSocket as unknown as typeof WebSocket,
      timeout: 5000,
      correlationId: 'base-id',
      autoReconnect: false,
      maxReconnectAttempts: 3,
      reconnectDelay: 100,
      maxReconnectDelay: 5000,
      heartbeatInterval: 30000,
      heartbeatTimeout: 10000,
    })

    // Verify initial state
    expect(transport.getState()).toBe(TransportState.DISCONNECTED)

    await transport.close()
  })

  it('should be equivalent to new WebSocketTransport()', async () => {
    const { createWebSocketTransport, WebSocketTransport } = await import('../transport/websocket')

    const options = {
      url: 'wss://api.example.com/ws',
      WebSocket: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    }

    const factoryTransport = createWebSocketTransport(options)
    const directTransport = new WebSocketTransport(options)

    // Both should be WebSocketTransport instances
    expect(factoryTransport).toBeInstanceOf(WebSocketTransport)
    expect(directTransport).toBeInstanceOf(WebSocketTransport)

    await factoryTransport.close()
    await directTransport.close()
  })
})

// ============================================================================
// createStubTransportFromStub Tests
// ============================================================================

describe('createStubTransportFromStub', () => {
  function createMockStub(response: unknown = { result: 'ok' }) {
    return {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
        headers: new Headers(),
      }),
    }
  }

  it('should create a StubTransport instance from a stub', async () => {
    const { createStubTransportFromStub, StubTransport } = await import('../transport/stub')

    const stub = createMockStub()
    const transport = createStubTransportFromStub({
      stub: stub as unknown as DurableObjectStub,
    })

    expect(transport).toBeInstanceOf(StubTransport)
    expect(typeof transport.send).toBe('function')
    expect(typeof transport.close).toBe('function')
    expect(typeof transport.getState).toBe('function')
    expect(typeof transport.getStub).toBe('function')
  })

  it('should pass all options to StubTransport constructor', async () => {
    const { createStubTransportFromStub } = await import('../transport/stub')
    const { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER, CORRELATION_ID_HEADER } = await import('../headers')

    const stub = createMockStub()
    const transport = createStubTransportFromStub({
      stub: stub as unknown as DurableObjectStub,
      baseUrl: 'https://custom-do',
      correlationId: 'base-correlation',
      headers: { 'X-Custom': 'header' },
      sourceDoId: 'source-123',
    })

    await transport.send({ method: 'test', args: [] })

    expect(stub.fetch).toHaveBeenCalledWith(
      'https://custom-do/rpc',
      expect.objectContaining({
        headers: expect.objectContaining({
          [CORRELATION_ID_HEADER]: 'base-correlation',
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-123',
          'X-Custom': 'header',
        }),
      })
    )
  })

  it('should return the original stub via getStub()', async () => {
    const { createStubTransportFromStub } = await import('../transport/stub')

    const stub = createMockStub()
    const transport = createStubTransportFromStub({
      stub: stub as unknown as DurableObjectStub,
    })

    expect(transport.getStub()).toBe(stub)
  })

  it('should be equivalent to new StubTransport()', async () => {
    const { createStubTransportFromStub, StubTransport } = await import('../transport/stub')

    const stub = createMockStub({ data: 'test' })
    const options = {
      stub: stub as unknown as DurableObjectStub,
    }

    const factoryTransport = createStubTransportFromStub(options)
    const directTransport = new StubTransport(options)

    // Both should be StubTransport instances
    expect(factoryTransport).toBeInstanceOf(StubTransport)
    expect(directTransport).toBeInstanceOf(StubTransport)

    // Both should return the same stub
    expect(factoryTransport.getStub()).toBe(directTransport.getStub())
  })
})

// ============================================================================
// Transport Index Exports Tests
// ============================================================================

describe('transport/index exports', () => {
  it('should export all transport types', async () => {
    const transportIndex = await import('../transport/index')

    // Types from types.ts
    expect(transportIndex.TransportState).toBeDefined()
    expect(typeof transportIndex.isCloseable).toBe('function')
    expect(typeof transportIndex.isStateful).toBe('function')
    expect(typeof transportIndex.supportsEvents).toBe('function')
  })

  it('should export FetchTransport and factory', async () => {
    const transportIndex = await import('../transport/index')

    expect(transportIndex.FetchTransport).toBeDefined()
    expect(typeof transportIndex.createFetchTransport).toBe('function')
  })

  it('should export WebSocketTransport and factory', async () => {
    const transportIndex = await import('../transport/index')

    expect(transportIndex.WebSocketTransport).toBeDefined()
    expect(typeof transportIndex.createWebSocketTransport).toBe('function')
  })

  it('should export StubTransport and factories', async () => {
    const transportIndex = await import('../transport/index')

    expect(transportIndex.StubTransport).toBeDefined()
    expect(typeof transportIndex.createStubTransport).toBe('function')
    expect(typeof transportIndex.createStubTransportFromStub).toBe('function')
  })

  it('should export TransportState enum values', async () => {
    const { TransportState } = await import('../transport/index')

    expect(TransportState.CONNECTED).toBe('CONNECTED')
    expect(TransportState.CONNECTING).toBe('CONNECTING')
    expect(TransportState.DISCONNECTED).toBe('DISCONNECTED')
    expect(TransportState.CLOSED).toBe('CLOSED')
  })
})

// ============================================================================
// Transport Type Guard Integration Tests
// ============================================================================

describe('Transport type guards with factory-created transports', () => {
  it('isCloseable should work with factory-created FetchTransport', async () => {
    const { createFetchTransport } = await import('../transport/fetch')
    const { isCloseable } = await import('../transport/types')

    const transport = createFetchTransport({ url: 'https://api.example.com' })

    expect(isCloseable(transport)).toBe(true)
    if (isCloseable(transport)) {
      await expect(transport.close()).resolves.toBeUndefined()
    }
  })

  it('isStateful should work with factory-created FetchTransport', async () => {
    const { createFetchTransport } = await import('../transport/fetch')
    const { isStateful, TransportState } = await import('../transport/types')

    const transport = createFetchTransport({ url: 'https://api.example.com' })

    expect(isStateful(transport)).toBe(true)
    if (isStateful(transport)) {
      expect(transport.getState()).toBe(TransportState.CONNECTED)
    }
  })

  it('supportsEvents should work with factory-created WebSocketTransport', async () => {
    const { createWebSocketTransport } = await import('../transport/websocket')
    const { supportsEvents } = await import('../transport/types')

    // Minimal mock WebSocket
    class MockWebSocket {
      static OPEN = 1
      static CLOSED = 3
      readyState = 0
      listeners: Record<string, Function[]> = {}

      constructor(_url: string) {}

      addEventListener(event: string, handler: Function) {
        if (!this.listeners[event]) {
          this.listeners[event] = []
        }
        this.listeners[event].push(handler)
      }

      removeEventListener(_event: string, _handler: Function) {}
      close() {}
    }

    const transport = createWebSocketTransport({
      url: 'wss://api.example.com/ws',
      WebSocket: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    })

    expect(supportsEvents(transport)).toBe(true)
    if (supportsEvents(transport)) {
      const unsubscribe = transport.addEventListener(() => {})
      expect(typeof unsubscribe).toBe('function')
      unsubscribe()
    }

    await transport.close()
  })

  it('supportsEvents should return false for FetchTransport', async () => {
    const { createFetchTransport } = await import('../transport/fetch')
    const { supportsEvents } = await import('../transport/types')

    const transport = createFetchTransport({ url: 'https://api.example.com' })

    expect(supportsEvents(transport)).toBe(false)
  })
})
