/**
 * Tests for SyncProvider context
 *
 * RED phase: These tests define the contract for SyncProvider.
 * They should fail until the implementation satisfies the contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import * as React from 'react'
import { MockWebSocket } from '../setup'

// Import from source
import { SyncProvider, useSyncContext } from '../../src/react/index'
import type { SyncContextValue, ConnectionState } from '../../src/react/index'

beforeEach(() => {
  MockWebSocket.instances = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SyncProvider', () => {
  describe('renders children', () => {
    it('should render child components', () => {
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

    it('should render nested children', () => {
      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <div data-testid="parent">
            <span data-testid="nested">Nested</span>
          </div>
        </SyncProvider>
      )

      expect(screen.getByTestId('parent')).toBeTruthy()
      expect(screen.getByTestId('nested')).toBeTruthy()
    })
  })

  describe('provides default context values', () => {
    it('should provide context with doUrl', () => {
      let contextValue: SyncContextValue | null = null

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
      expect(contextValue!.doUrl).toBe('https://api.example.com/do/workspace')
    })

    it('should provide default connectionState as connecting', () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Initial state should be 'connecting' before WebSocket opens
      expect(contextValue!.connectionState).toBe('connecting')
    })

    it('should provide default reconnectAttempts as 0', () => {
      let contextValue: SyncContextValue | null = null

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

    it('should provide default lastSyncAt as null', () => {
      let contextValue: SyncContextValue | null = null

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

  describe('accepts doUrl prop', () => {
    it('should pass doUrl to context', () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://my-custom-do.workers.dev/do/tenant">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.doUrl).toBe('https://my-custom-do.workers.dev/do/tenant')
    })

    it('should create WebSocket with derived URL', async () => {
      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <div>Test</div>
        </SyncProvider>
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]
      expect(ws.url).toBe('wss://api.example.com/do/workspace/sync')
    })

    it('should convert http to ws for WebSocket URL', async () => {
      render(
        <SyncProvider doUrl="http://localhost:8787/do/test">
          <div>Test</div>
        </SyncProvider>
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]
      expect(ws.url).toBe('ws://localhost:8787/do/test/sync')
    })
  })

  describe('accepts getAuthToken prop', () => {
    it('should pass getAuthToken to context', () => {
      let contextValue: SyncContextValue | null = null
      const mockGetAuthToken = vi.fn(() => 'test-token')

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace" getAuthToken={mockGetAuthToken}>
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.getAuthToken).toBe(mockGetAuthToken)
    })

    it('should allow undefined getAuthToken', () => {
      let contextValue: SyncContextValue | null = null

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

    it('should pass getAuthToken function that returns null', () => {
      let contextValue: SyncContextValue | null = null
      const mockGetAuthToken = vi.fn(() => null)

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace" getAuthToken={mockGetAuthToken}>
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.getAuthToken).toBe(mockGetAuthToken)
      expect(contextValue!.getAuthToken!()).toBeNull()
    })
  })

  describe('provides connectionState to consumers', () => {
    it('should provide connectionState in context', () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.connectionState).toBeDefined()
      expect(['connecting', 'connected', 'reconnecting', 'error']).toContain(
        contextValue!.connectionState
      )
    })

    it('should be connecting initially', () => {
      let contextValue: SyncContextValue | null = null

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
  })

  describe('updates connectionState on WebSocket events', () => {
    it('should update to connected when WebSocket opens', async () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return <div data-testid="state">{contextValue?.connectionState}</div>
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Wait for WebSocket to connect
      await waitFor(() => {
        expect(screen.getByTestId('state').textContent).toBe('connected')
      })

      expect(contextValue!.connectionState).toBe('connected')
    })

    it('should update to reconnecting when WebSocket closes', async () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return <div data-testid="state">{contextValue?.connectionState}</div>
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Wait for connection
      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Wait for connected state first
      await waitFor(() => {
        expect(screen.getByTestId('state').textContent).toBe('connected')
      })

      // Simulate close
      act(() => {
        ws.simulateClose()
      })

      await waitFor(() => {
        expect(screen.getByTestId('state').textContent).toBe('reconnecting')
      })
    })

    it('should update to error when WebSocket errors', async () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return <div data-testid="state">{contextValue?.connectionState}</div>
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Simulate error
      act(() => {
        ws.simulateError()
      })

      await waitFor(() => {
        expect(screen.getByTestId('state').textContent).toBe('error')
      })
    })

    it('should reset reconnectAttempts when connected', async () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return <div data-testid="attempts">{contextValue?.reconnectAttempts}</div>
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByTestId('attempts').textContent).toBe('0')
      })

      expect(contextValue!.reconnectAttempts).toBe(0)
    })
  })

  describe('exposes reconnectAttempts count', () => {
    it('should provide reconnectAttempts in context', () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue!.reconnectAttempts).toBeDefined()
      expect(typeof contextValue!.reconnectAttempts).toBe('number')
    })

    it('should start at 0', () => {
      let contextValue: SyncContextValue | null = null

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
  })

  describe('provides lastSyncAt timestamp', () => {
    it('should provide lastSyncAt in context', () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      expect(contextValue).toHaveProperty('lastSyncAt')
    })

    it('should start as null', () => {
      let contextValue: SyncContextValue | null = null

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

    it('should be Date or null type', () => {
      let contextValue: SyncContextValue | null = null

      function Consumer() {
        contextValue = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer />
        </SyncProvider>
      )

      // Initially null
      expect(contextValue!.lastSyncAt === null || contextValue!.lastSyncAt instanceof Date).toBe(
        true
      )
    })
  })

  describe('cleanup on unmount', () => {
    it('should close WebSocket on unmount', async () => {
      const { unmount } = render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <div>Test</div>
        </SyncProvider>
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      unmount()

      expect(ws.close).toHaveBeenCalled()
    })
  })
})

describe('useSyncContext', () => {
  describe('throws when used outside provider', () => {
    it('should throw error when used outside SyncProvider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      function Consumer() {
        useSyncContext()
        return null
      }

      expect(() => {
        render(<Consumer />)
      }).toThrow('useSyncContext must be used within a SyncProvider')

      spy.mockRestore()
    })

    it('should have descriptive error message', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      function Consumer() {
        useSyncContext()
        return null
      }

      try {
        render(<Consumer />)
      } catch (error) {
        expect((error as Error).message).toContain('SyncProvider')
      }

      spy.mockRestore()
    })
  })

  describe('returns context values inside provider', () => {
    it('should return context value with all required properties', () => {
      let contextValue: SyncContextValue | null = null

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
      expect(contextValue).toHaveProperty('lastSyncAt')
    })

    it('should return same context across multiple consumers', () => {
      let contextValue1: SyncContextValue | null = null
      let contextValue2: SyncContextValue | null = null

      function Consumer1() {
        contextValue1 = useSyncContext()
        return null
      }

      function Consumer2() {
        contextValue2 = useSyncContext()
        return null
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Consumer1 />
          <Consumer2 />
        </SyncProvider>
      )

      expect(contextValue1!.doUrl).toBe(contextValue2!.doUrl)
      expect(contextValue1!.connectionState).toBe(contextValue2!.connectionState)
    })

    it('should work with nested consumers', () => {
      let contextValue: SyncContextValue | null = null

      function NestedConsumer() {
        contextValue = useSyncContext()
        return null
      }

      function Parent() {
        return (
          <div>
            <NestedConsumer />
          </div>
        )
      }

      render(
        <SyncProvider doUrl="https://api.example.com/do/workspace">
          <Parent />
        </SyncProvider>
      )

      expect(contextValue).not.toBeNull()
      expect(contextValue!.doUrl).toBe('https://api.example.com/do/workspace')
    })
  })
})
