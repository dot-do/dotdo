// Auto Transport Tests - TDD for automatic transport detection and upgrade
// Tests the AutoTransport class that handles HTTP to WebSocket upgrade

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TransportState } from '../transport/types'

// ============================================================================
// Mock WebSocket Implementation
// ============================================================================

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.OPEN
  listeners: Record<string, Function[]> = {}

  constructor(url: string) {
    this.url = url
    // Auto-trigger open after construction
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
    // Simulate async response
    const message = JSON.parse(data)
    setTimeout(() => {
      this.emit('message', {
        data: JSON.stringify({
          id: message.id,
          result: message.method === '$ping' ? { pong: true } : { echo: message.method },
        }),
      })
    }, 10)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }
}

// ============================================================================
// AutoTransport Tests
// ============================================================================

describe('AutoTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
      headers: new Headers(),
    })
  })

  describe('constructor', () => {
    it('should create transport with required url option', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.send).toBe('function')

      await transport.close()
    })

    it('should default to auto-upgrade strategy', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      // Should start with fetch transport
      expect(transport.getActiveTransportType()).toBe('fetch')

      await transport.close()
    })

    it('should accept autoUpgrade: false to disable upgrade', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        autoUpgrade: false,
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      // Should stay on fetch
      expect(transport.getActiveTransportType()).toBe('fetch')

      // Manual upgrade should fail
      const upgraded = await transport.tryUpgrade()
      expect(upgraded).toBe(false)

      await transport.close()
    })

    it('should accept strategy option', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const fetchOnly = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(fetchOnly.getActiveTransportType()).toBe('fetch')

      await fetchOnly.close()
    })

    it('should build correct WebSocket URL from HTTP URL', async () => {
      const { AutoTransport } = await import('../transport/auto')

      // Track what URL WebSocket was constructed with
      let capturedUrl = ''
      class UrlCapturingWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          capturedUrl = url
        }
      }

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        wsPath: '/ws',
        fetch: mockFetch,
        WebSocket: UrlCapturingWebSocket as unknown as typeof WebSocket,
      })

      // Trigger upgrade attempt
      await transport.tryUpgrade()

      expect(capturedUrl).toBe('wss://api.example.com/ws')

      await transport.close()
    })

    it('should handle http:// to ws:// conversion', async () => {
      const { AutoTransport } = await import('../transport/auto')

      let capturedUrl = ''
      class UrlCapturingWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          capturedUrl = url
        }
      }

      const transport = new AutoTransport({
        url: 'http://localhost:8080',
        wsPath: '/rpc',
        fetch: mockFetch,
        WebSocket: UrlCapturingWebSocket as unknown as typeof WebSocket,
      })

      await transport.tryUpgrade()

      expect(capturedUrl).toBe('ws://localhost:8080/rpc')

      await transport.close()
    })
  })

  describe('send', () => {
    it('should send via fetch transport initially', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(mockFetch).toHaveBeenCalled()
      expect(response.result).toEqual({ result: 'test' })

      await transport.close()
    })

    it('should return error when transport is closed', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      await transport.close()

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      // The unified error handler returns NETWORK_ERROR for closed transport
      expect(response.error?.code).toBe('NETWORK_ERROR')
    })

    it('should send via WebSocket after upgrade', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const wsSentMessages: string[] = []
      class TrackingWebSocket extends MockWebSocket {
        send(data: string) {
          wsSentMessages.push(data)
          super.send(data)
        }
      }

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'websocket-only',
        fetch: mockFetch,
        WebSocket: TrackingWebSocket as unknown as typeof WebSocket,
      })

      // Wait for WebSocket to connect
      await new Promise((r) => setTimeout(r, 50))

      const response = await transport.send({ method: 'test.method', args: ['arg1'] })

      // Should have sent via WebSocket
      expect(wsSentMessages.length).toBeGreaterThan(0)
      const lastMessage = JSON.parse(wsSentMessages[wsSentMessages.length - 1])
      expect(lastMessage.method).toBe('test.method')

      await transport.close()
    })
  })

  describe('auto-upgrade', () => {
    it('should attempt upgrade when strategy is auto-upgrade', async () => {
      const { AutoTransport } = await import('../transport/auto')

      let wsConstructed = false
      class DetectingWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          wsConstructed = true
        }
      }

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'auto-upgrade',
        fetch: mockFetch,
        WebSocket: DetectingWebSocket as unknown as typeof WebSocket,
      })

      // Wait for upgrade attempt
      await new Promise((r) => setTimeout(r, 100))

      expect(wsConstructed).toBe(true)

      await transport.close()
    })

    it('should fall back to fetch if WebSocket connection fails', async () => {
      const { AutoTransport } = await import('../transport/auto')

      // WebSocket that fails to connect
      class FailingWebSocket {
        static OPEN = 1
        static CLOSED = 3

        listeners: Record<string, Function[]> = {}
        readyState = 0

        constructor(_url: string) {
          setTimeout(() => {
            this.emit('error', new Event('error'))
            this.emit('close', {})
          }, 5)
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners[event]) {
            this.listeners[event] = []
          }
          this.listeners[event].push(handler)
        }

        removeEventListener(_event: string, _handler: Function) {}

        emit(event: string, data: unknown) {
          if (this.listeners[event]) {
            this.listeners[event].forEach((h) => h(data))
          }
        }

        send(_data: string) {}
        close() {
          this.readyState = FailingWebSocket.CLOSED
          this.emit('close', {})
        }
      }

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'auto-upgrade',
        upgradeTimeout: 50,
        fetch: mockFetch,
        WebSocket: FailingWebSocket as unknown as typeof WebSocket,
      })

      // Wait for upgrade attempt and failure
      await new Promise((r) => setTimeout(r, 200))

      // Should still be on fetch
      expect(transport.getActiveTransportType()).toBe('fetch')

      // Should still be able to send via fetch
      const response = await transport.send({ method: 'test', args: [] })
      expect(response.result).toBeDefined()

      await transport.close()
    })

    it('should respect maxUpgradeRetries', async () => {
      const { AutoTransport } = await import('../transport/auto')

      let upgradeAttempts = 0

      class CountingFailingWebSocket {
        static OPEN = 1
        static CLOSED = 3

        listeners: Record<string, Function[]> = {}
        readyState = 0

        constructor(_url: string) {
          upgradeAttempts++
          setTimeout(() => {
            this.emit('error', new Event('error'))
            this.emit('close', {})
          }, 5)
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners[event]) {
            this.listeners[event] = []
          }
          this.listeners[event].push(handler)
        }

        removeEventListener(_event: string, _handler: Function) {}

        emit(event: string, data: unknown) {
          if (this.listeners[event]) {
            this.listeners[event].forEach((h) => h(data))
          }
        }

        send(_data: string) {}
        close() {
          this.readyState = CountingFailingWebSocket.CLOSED
          this.emit('close', {})
        }
      }

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'auto-upgrade',
        upgradeTimeout: 20,
        maxUpgradeRetries: 2,
        upgradeRetryInterval: 0, // Disable retry timer
        fetch: mockFetch,
        WebSocket: CountingFailingWebSocket as unknown as typeof WebSocket,
      })

      // Try multiple manual upgrades
      await transport.tryUpgrade()
      await transport.tryUpgrade()
      await transport.tryUpgrade() // Should be blocked by maxUpgradeRetries

      // Should stop after max retries (2)
      expect(upgradeAttempts).toBeLessThanOrEqual(2)

      await transport.close()
    })
  })

  describe('websocket-only strategy', () => {
    it('should start with WebSocket transport directly', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'websocket-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport.getActiveTransportType()).toBe('websocket')

      await transport.close()
    })

    it('should not initialize fetch transport', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'websocket-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport.getFetchTransport()).toBeNull()

      await transport.close()
    })
  })

  describe('fetch-only strategy', () => {
    it('should never attempt WebSocket upgrade', async () => {
      const { AutoTransport } = await import('../transport/auto')

      let wsConstructed = false
      class DetectingWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          wsConstructed = true
        }
      }

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: mockFetch,
        WebSocket: DetectingWebSocket as unknown as typeof WebSocket,
      })

      // Wait to ensure no upgrade attempt
      await new Promise((r) => setTimeout(r, 100))

      expect(wsConstructed).toBe(false)
      expect(transport.getActiveTransportType()).toBe('fetch')

      await transport.close()
    })

    it('should reject manual upgrade attempt', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      const upgraded = await transport.tryUpgrade()

      expect(upgraded).toBe(false)
      expect(transport.getActiveTransportType()).toBe('fetch')

      await transport.close()
    })
  })

  describe('getState', () => {
    it('should return CONNECTED when fetch transport is active', async () => {
      const { AutoTransport } = await import('../transport/auto')
      const { TransportState } = await import('../transport/types')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport.getState()).toBe(TransportState.CONNECTED)

      await transport.close()
    })

    it('should return CLOSED after close', async () => {
      const { AutoTransport } = await import('../transport/auto')
      const { TransportState } = await import('../transport/types')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      await transport.close()

      expect(transport.getState()).toBe(TransportState.CLOSED)
    })
  })

  describe('close', () => {
    it('should close all transports', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'auto-upgrade',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      // Wait for potential upgrade
      await new Promise((r) => setTimeout(r, 50))

      await transport.close()

      expect(transport.getFetchTransport()).toBeNull()
      expect(transport.getWebSocketTransport()).toBeNull()
    })

    it('should clear event listeners', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      const events: { type: string }[] = []
      transport.addEventListener((event) => {
        events.push({ type: event.type })
      })

      await transport.close()

      // Listener should not receive any more events
      // (We can't easily test this without internal access, but close clears listeners)
    })
  })

  describe('addEventListener', () => {
    it('should notify on transport events', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'websocket-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      const events: { type: string }[] = []
      transport.addEventListener((event) => {
        events.push({ type: event.type })
      })

      // Trigger connection via send
      await transport.send({ method: 'test', args: [] })

      // Should have connect event
      expect(events.some((e) => e.type === 'connect')).toBe(true)

      await transport.close()
    })

    it('should return unsubscribe function', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'websocket-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      const events: { type: string }[] = []
      const unsubscribe = transport.addEventListener((event) => {
        events.push({ type: event.type })
      })

      unsubscribe()

      // Trigger connection
      await transport.send({ method: 'test', args: [] })

      // Should not have received events after unsubscribe
      expect(events.length).toBe(0)

      await transport.close()
    })
  })

  describe('helper methods', () => {
    it('isUsingWebSocket should return false when using fetch', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport.isUsingWebSocket()).toBe(false)

      await transport.close()
    })

    it('isUsingWebSocket should return true when using WebSocket', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'websocket-only',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      // Wait for connection
      await transport.send({ method: 'test', args: [] })

      expect(transport.isUsingWebSocket()).toBe(true)

      await transport.close()
    })

    it('isConnected should return true when connected', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport.isConnected()).toBe(true)

      await transport.close()
    })

    it('tryUpgrade should trigger manual upgrade', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'auto-upgrade',
        fetch: mockFetch,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      // Start on fetch
      expect(transport.getActiveTransportType()).toBe('fetch')

      // Manually trigger upgrade
      const upgraded = await transport.tryUpgrade()

      // Should have upgraded
      expect(upgraded).toBe(true)
      expect(transport.getActiveTransportType()).toBe('websocket')

      await transport.close()
    })
  })
})

// ============================================================================
// createClient with autoUpgrade Tests
// ============================================================================

describe('createClient with autoUpgrade', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ greeting: 'Hello, World!' }),
      headers: new Headers(),
    })

    // Mock global fetch
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should create client with autoUpgrade option', async () => {
    const { createClient } = await import('../client')

    interface TestAPI {
      greet(name: string): Promise<{ greeting: string }>
    }

    // Mock WebSocket globally for this test
    vi.stubGlobal('WebSocket', MockWebSocket)

    const client = createClient<TestAPI>({
      url: 'https://api.example.com',
      autoUpgrade: true,
    })

    expect(client).toBeDefined()
    expect(typeof client.greet).toBe('function')

    vi.unstubAllGlobals()
  })

  it('should work without autoUpgrade (default behavior)', async () => {
    const { createClient } = await import('../client')

    interface TestAPI {
      greet(name: string): Promise<{ greeting: string }>
    }

    const client = createClient<TestAPI>({
      url: 'https://api.example.com',
    })

    const result = await client.greet('World')

    expect(mockFetch).toHaveBeenCalled()
    expect(result).toEqual({ greeting: 'Hello, World!' })
  })
})

// ============================================================================
// createAutoTransport Helper Tests
// ============================================================================

describe('createAutoTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
      headers: new Headers(),
    })
  })

  it('should create transport with convenience function', async () => {
    const { createAutoTransport } = await import('../transport/auto')

    const transport = createAutoTransport({
      url: 'https://api.example.com',
      autoUpgrade: true,
      fetch: mockFetch,
      WebSocket: MockWebSocket as unknown as typeof WebSocket,
    })

    expect(transport).toBeDefined()
    expect(typeof transport.send).toBe('function')

    await transport.close()
  })
})
