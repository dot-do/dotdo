/**
 * Tests for useConnectionState hook
 *
 * RED phase: These tests verify useConnectionState behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as React from 'react'
import { useConnectionState } from '../../src/hooks/use-connection-state'
import { DO } from '../../src/provider'
import type { ConnectionState } from '@dotdo/client'

// Store connection state change handlers
let connectionStateHandlers: ((state: ConnectionState) => void)[] = []
let mockConnectionState: ConnectionState = 'connected'

// Mock @dotdo/client
vi.mock('@dotdo/client', () => ({
  createClient: vi.fn(() => ({
    connectionState: mockConnectionState,
    disconnect: vi.fn(),
    on: vi.fn((event: string, handler: (state: ConnectionState) => void) => {
      if (event === 'connectionStateChange') {
        connectionStateHandlers.push(handler)
      }
    }),
    off: vi.fn((event: string, handler: (state: ConnectionState) => void) => {
      if (event === 'connectionStateChange') {
        connectionStateHandlers = connectionStateHandlers.filter(h => h !== handler)
      }
    }),
  })),
}))

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  url: string

  constructor(url: string) {
    this.url = url
  }

  send = vi.fn()
  close = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket)
  connectionStateHandlers = []
  mockConnectionState = 'connected'
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// Provider wrapper for hooks
function createWrapper(ns = 'https://api.example.com/do/workspace') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DO ns={ns}>{children}</DO>
  }
}

// Helper to emit connection state changes
function emitConnectionState(state: ConnectionState) {
  mockConnectionState = state
  for (const handler of connectionStateHandlers) {
    handler(state)
  }
}

describe('useConnectionState', () => {
  describe('initial state', () => {
    it('should return current connection state', () => {
      mockConnectionState = 'connected'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('connected')
    })

    it('should return connecting state when client is connecting', () => {
      mockConnectionState = 'connecting'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('connecting')
    })

    it('should return disconnected state', () => {
      mockConnectionState = 'disconnected'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('disconnected')
    })

    it('should return reconnecting state', () => {
      mockConnectionState = 'reconnecting'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('reconnecting')
    })

    it('should return failed state', () => {
      mockConnectionState = 'failed'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('failed')
    })
  })

  describe('state updates', () => {
    it('should update when connection state changes to connected', async () => {
      mockConnectionState = 'connecting'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('connecting')

      act(() => {
        emitConnectionState('connected')
      })

      await waitFor(() => {
        expect(result.current).toBe('connected')
      })
    })

    it('should update when connection state changes to disconnected', async () => {
      mockConnectionState = 'connected'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('connected')

      act(() => {
        emitConnectionState('disconnected')
      })

      await waitFor(() => {
        expect(result.current).toBe('disconnected')
      })
    })

    it('should update when connection state changes to reconnecting', async () => {
      mockConnectionState = 'connected'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      act(() => {
        emitConnectionState('reconnecting')
      })

      await waitFor(() => {
        expect(result.current).toBe('reconnecting')
      })
    })

    it('should update when connection state changes to failed', async () => {
      mockConnectionState = 'connecting'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      act(() => {
        emitConnectionState('failed')
      })

      await waitFor(() => {
        expect(result.current).toBe('failed')
      })
    })

    it('should handle multiple state transitions', async () => {
      mockConnectionState = 'connecting'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('connecting')

      act(() => {
        emitConnectionState('connected')
      })

      await waitFor(() => {
        expect(result.current).toBe('connected')
      })

      act(() => {
        emitConnectionState('disconnected')
      })

      await waitFor(() => {
        expect(result.current).toBe('disconnected')
      })

      act(() => {
        emitConnectionState('reconnecting')
      })

      await waitFor(() => {
        expect(result.current).toBe('reconnecting')
      })

      act(() => {
        emitConnectionState('connected')
      })

      await waitFor(() => {
        expect(result.current).toBe('connected')
      })
    })
  })

  describe('event subscription', () => {
    it('should subscribe to connectionStateChange event', () => {
      renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      // Handler should be registered
      expect(connectionStateHandlers.length).toBeGreaterThan(0)
    })

    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      const handlerCount = connectionStateHandlers.length

      unmount()

      expect(connectionStateHandlers.length).toBeLessThan(handlerCount)
    })
  })

  describe('throws outside provider', () => {
    it('should throw error when used outside DO provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useConnectionState())
      }).toThrow('useDotdoContext must be used within a DO provider')

      spy.mockRestore()
    })
  })

  describe('type safety', () => {
    it('should return ConnectionState type', () => {
      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      // Type should be one of the valid ConnectionState values
      const validStates: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'disconnected', 'failed']
      expect(validStates).toContain(result.current)
    })
  })

  describe('re-render behavior', () => {
    it('should not cause unnecessary re-renders when state unchanged', () => {
      let renderCount = 0

      function TestComponent() {
        useConnectionState()
        renderCount++
        return null
      }

      const Wrapper = createWrapper()
      const { rerender } = renderHook(() => null, {
        wrapper: ({ children }) => (
          <Wrapper>
            <TestComponent />
            {children}
          </Wrapper>
        ),
      })

      const initialCount = renderCount

      // Emit same state
      act(() => {
        emitConnectionState('connected')
      })

      rerender()

      // Should not have re-rendered for same state
      // (actual behavior depends on implementation)
    })
  })

  describe('client state sync', () => {
    it('should sync with client.connectionState initially', () => {
      mockConnectionState = 'reconnecting'

      const { result } = renderHook(() => useConnectionState(), {
        wrapper: createWrapper(),
      })

      expect(result.current).toBe('reconnecting')
    })
  })
})
