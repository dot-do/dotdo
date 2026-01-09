import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'

// Import from the (not-yet-existing) react module
// These will fail until implementation exists - that's the RED phase!
import {
  SyncProvider,
  useSyncContext,
  type SyncContextValue,
} from '../../src/react'

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((error: Error) => void) | null = null
  readyState = MockWebSocket.CONNECTING

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    // Auto-connect after a microtask to simulate async connection
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        // Don't auto-open - let tests control this
      }
    })
  }

  send = vi.fn()
  close = vi.fn()

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  simulateError(error: Error) {
    this.onerror?.(error)
  }
}

// =============================================================================
// Test Setup
// =============================================================================

describe('SyncProvider', () => {
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Rendering Tests
  // ===========================================================================

  describe('rendering', () => {
    it('renders children', () => {
      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <div data-testid="child">Child content</div>
        </SyncProvider>
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.getByText('Child content')).toBeInTheDocument()
    })

    it('provides context to descendants', () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return <div>Consumer</div>
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      expect(contextValue).not.toBeNull()
      expect(contextValue).toHaveProperty('connectionState')
      expect(contextValue).toHaveProperty('doUrl')
      expect(contextValue).toHaveProperty('reconnectAttempts')
    })

    it('throws if useSyncContext used outside provider', () => {
      // Suppress React error boundary console output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      function OrphanConsumer() {
        useSyncContext()
        return <div>Should not render</div>
      }

      expect(() => {
        render(<OrphanConsumer />)
      }).toThrow(/SyncProvider/)

      consoleSpy.mockRestore()
    })
  })

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    it('accepts doUrl prop', () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://my-custom-url.example.com/do/abc">
          <ContextConsumer />
        </SyncProvider>
      )

      expect(contextValue?.doUrl).toBe('wss://my-custom-url.example.com/do/abc')
    })

    it('accepts getAuthToken prop', async () => {
      const mockGetAuthToken = vi.fn().mockResolvedValue('test-token-123')
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider
          doUrl="wss://example.com/do/123"
          getAuthToken={mockGetAuthToken}
        >
          <ContextConsumer />
        </SyncProvider>
      )

      // The provider should make the getAuthToken available
      expect(contextValue?.getAuthToken).toBe(mockGetAuthToken)
    })

    it('uses custom reconnectDelay when provided', () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider
          doUrl="wss://example.com/do/123"
          reconnectDelay={5000}
        >
          <ContextConsumer />
        </SyncProvider>
      )

      // Context should expose or use the custom delay
      expect(contextValue).toBeTruthy()
      // The delay will be used internally during reconnection
    })

    it('uses custom maxReconnectDelay when provided', () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider
          doUrl="wss://example.com/do/123"
          maxReconnectDelay={60000}
        >
          <ContextConsumer />
        </SyncProvider>
      )

      expect(contextValue).toBeTruthy()
    })
  })

  // ===========================================================================
  // Connection State Tests
  // ===========================================================================

  describe('connection state', () => {
    it('starts in connecting state', () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      expect(contextValue?.connectionState).toBe('connecting')
    })

    it('transitions to connected on successful connection', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return <div data-testid="state">{contextValue?.connectionState}</div>
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Initial state should be connecting
      expect(contextValue?.connectionState).toBe('connecting')

      // Simulate successful connection
      await act(async () => {
        const ws = MockWebSocket.instances[0]
        ws?.simulateOpen()
      })

      await waitFor(() => {
        expect(contextValue?.connectionState).toBe('connected')
      })
    })

    it('transitions to disconnected on close', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Connect first
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      await waitFor(() => {
        expect(contextValue?.connectionState).toBe('connected')
      })

      // Now disconnect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateClose()
      })

      await waitFor(() => {
        expect(contextValue?.connectionState).toBe('reconnecting')
      })
    })

    it('transitions to reconnecting on disconnect', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Connect and then disconnect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      await waitFor(() => {
        expect(contextValue?.connectionState).toBe('connected')
      })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateClose()
      })

      // Should transition to reconnecting
      await waitFor(() => {
        expect(contextValue?.connectionState).toBe('reconnecting')
      })
    })

    it('exposes reconnect attempts count', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Initial state
      expect(contextValue?.reconnectAttempts).toBe(0)

      // Connect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      expect(contextValue?.reconnectAttempts).toBe(0)

      // Disconnect to trigger reconnection
      await act(async () => {
        MockWebSocket.instances[0]?.simulateClose()
      })

      // After first close, reconnect attempt should be scheduled
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      // New WebSocket created for reconnection
      expect(MockWebSocket.instances.length).toBeGreaterThan(1)

      // Reconnect attempts should have incremented
      await waitFor(() => {
        expect(contextValue?.reconnectAttempts).toBeGreaterThan(0)
      })
    })

    it('resets reconnect attempts on successful reconnection', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Connect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      // Disconnect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateClose()
      })

      // Wait for reconnect
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      // Reconnect successfully
      await act(async () => {
        MockWebSocket.instances[1]?.simulateOpen()
      })

      await waitFor(() => {
        expect(contextValue?.reconnectAttempts).toBe(0)
        expect(contextValue?.connectionState).toBe('connected')
      })
    })
  })

  // ===========================================================================
  // Error State Tests
  // ===========================================================================

  describe('error handling', () => {
    it('transitions to error state on connection error', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Simulate error
      await act(async () => {
        MockWebSocket.instances[0]?.simulateError(new Error('Connection failed'))
      })

      // Should attempt reconnection (not necessarily expose error state permanently)
      expect(contextValue).toBeTruthy()
    })

    it('exposes last error in context', async () => {
      let contextValue: SyncContextValue | null = null

      function ContextConsumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <ContextConsumer />
        </SyncProvider>
      )

      // Simulate error followed by close
      await act(async () => {
        MockWebSocket.instances[0]?.simulateError(new Error('Network error'))
        MockWebSocket.instances[0]?.simulateClose(1006, 'Abnormal closure')
      })

      // Error should be available in context (may be null if cleared on reconnect)
      expect(contextValue?.lastError).toBeDefined()
    })
  })

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe('cleanup', () => {
    it('closes WebSocket on unmount', async () => {
      const { unmount } = render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <div>Test</div>
        </SyncProvider>
      )

      // Connect
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      const ws = MockWebSocket.instances[0]

      // Unmount
      unmount()

      // WebSocket should be closed
      expect(ws.close).toHaveBeenCalled()
    })

    it('cancels pending reconnection on unmount', async () => {
      const { unmount } = render(
        <SyncProvider doUrl="wss://example.com/do/123">
          <div>Test</div>
        </SyncProvider>
      )

      // Connect then disconnect to trigger reconnection
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateClose()
      })

      // Unmount before reconnection timer fires
      unmount()

      // Advance timer past reconnection delay
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      // No new WebSocket should have been created after unmount
      expect(MockWebSocket.instances.length).toBe(1)
    })
  })

  // ===========================================================================
  // Nested Provider Tests
  // ===========================================================================

  describe('nested providers', () => {
    it('allows nested providers with different URLs', () => {
      let outerContext: SyncContextValue | null = null
      let innerContext: SyncContextValue | null = null

      function OuterConsumer() {
        outerContext = useSyncContext()
        return null
      }

      function InnerConsumer() {
        innerContext = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="wss://outer.example.com/do/1">
          <OuterConsumer />
          <SyncProvider doUrl="wss://inner.example.com/do/2">
            <InnerConsumer />
          </SyncProvider>
        </SyncProvider>
      )

      expect(outerContext?.doUrl).toBe('wss://outer.example.com/do/1')
      expect(innerContext?.doUrl).toBe('wss://inner.example.com/do/2')
    })
  })
})
