/**
 * Tests for SyncProvider component
 *
 * RED phase: Tests define the SyncProvider contract
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import * as React from 'react'
import { SyncProvider, useSyncContext } from '../../src/react/provider'

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  url: string
  private handlers: Map<string, Array<(event: Event | MessageEvent | CloseEvent) => void>> = new Map()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.emit('open', new Event('open'))
    }, 0)
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close'))
  })

  addEventListener(event: string, handler: (event: Event | MessageEvent | CloseEvent) => void) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
  }

  removeEventListener = vi.fn()

  emit(event: string, data: Event | MessageEvent | CloseEvent) {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(data)
    }
  }

  receiveMessage(data: unknown) {
    const messageEvent = new MessageEvent('message', {
      data: JSON.stringify(data),
    })
    this.emit('message', messageEvent)
  }

  simulateError() {
    this.emit('error', new Event('error'))
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close'))
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('SyncProvider', () => {
  describe('rendering', () => {
    it('should render children', () => {
      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <div data-testid="child">Hello</div>
        </SyncProvider>
      )

      expect(screen.getByTestId('child')).toBeTruthy()
      expect(screen.getByText('Hello')).toBeTruthy()
    })

    it('should render multiple children', () => {
      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <div data-testid="child1">First</div>
          <div data-testid="child2">Second</div>
        </SyncProvider>
      )

      expect(screen.getByTestId('child1')).toBeTruthy()
      expect(screen.getByTestId('child2')).toBeTruthy()
    })

    it('should provide context to descendants', () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return <div data-testid="consumer">Consumer</div>
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue).not.toBeNull()
      expect(contextValue!.doUrl).toBe('https://api.example.com/do/workspace')
    })

    it('should throw if useSyncContext used outside provider', () => {
      function Consumer() {
        useSyncContext()
        return null
      }

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<Consumer />)
      }).toThrow('useSyncContext must be used within a SyncProvider')

      consoleSpy.mockRestore()
    })
  })

  describe('configuration', () => {
    it('should accept doUrl prop', () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://my-do.example.com/do/tenant">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.doUrl).toBe('https://my-do.example.com/do/tenant')
    })

    it('should accept getAuthToken prop', () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null
      const getAuthToken = vi.fn(() => 'test-token')

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace" getAuthToken={getAuthToken}>
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.getAuthToken).toBe(getAuthToken)
    })

    it('should default to no auth when getAuthToken not provided', () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.getAuthToken).toBeUndefined()
    })
  })

  describe('connection state', () => {
    it('should start in connecting state', () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.connectionState).toBe('connecting')
    })

    it('should transition to connected on successful connection', async () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return <div data-testid="state">{contextValue.connectionState}</div>
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Wait for WebSocket to connect
      await vi.waitFor(() => {
        expect(contextValue!.connectionState).toBe('connected')
      })
    })

    it('should transition to reconnecting on disconnect', async () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Wait for WebSocket to connect
      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Simulate disconnect
      await act(async () => {
        ws.simulateClose()
      })

      expect(contextValue!.connectionState).toBe('reconnecting')
    })

    it('should transition to error on persistent failure', async () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Wait for WebSocket to initialize
      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Simulate error
      await act(async () => {
        ws.simulateError()
      })

      expect(contextValue!.connectionState).toBe('error')
    })

    it('should expose reconnect attempts count', async () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.reconnectAttempts).toBe(0)
    })

    it('should expose last sync timestamp', () => {
      let contextValue: ReturnType<typeof useSyncContext> | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.lastSyncAt).toBeNull()
    })
  })

  describe('cleanup', () => {
    it('should disconnect WebSocket on unmount', async () => {
      const { unmount } = render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <div>Test</div>
        </SyncProvider>
      )

      // Wait for WebSocket to be created
      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      unmount()

      expect(ws.close).toHaveBeenCalled()
    })
  })
})

describe('useSyncContext', () => {
  it('should throw when used outside provider', () => {
    function Consumer() {
      useSyncContext()
      return null
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<Consumer />)
    }).toThrow('useSyncContext must be used within a SyncProvider')

    consoleSpy.mockRestore()
  })

  it('should return context values inside provider', () => {
    let contextValue: ReturnType<typeof useSyncContext> | null = null

    function Consumer() {
      contextValue = useSyncContext()
      return null
    }

    render(
      <SyncProvider doUrl="https://api.example.com/do/workspace">
        <Consumer />
      </SyncProvider>
    )

    expect(contextValue).not.toBeNull()
    expect(contextValue!.doUrl).toBeDefined()
    expect(contextValue!.connectionState).toBeDefined()
    expect(contextValue!.reconnectAttempts).toBeDefined()
    expect(contextValue!.lastSyncAt).toBeDefined()
  })
})
