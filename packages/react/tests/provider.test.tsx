/**
 * Tests for DO provider component
 *
 * RED phase: These tests verify provider behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import * as React from 'react'
import { DO } from '../src/provider'
import { DotdoContext } from '../src/context'
import { createClient } from '@dotdo/client'

// Mock @dotdo/client
vi.mock('@dotdo/client', () => ({
  createClient: vi.fn(() => ({
    connectionState: 'connected',
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
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
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('DO provider', () => {
  describe('renders children', () => {
    it('should render child components', () => {
      render(
        <DO ns="https://api.example.com/do/workspace">
          <div data-testid="child">Hello</div>
        </DO>
      )

      expect(screen.getByTestId('child')).toBeTruthy()
      expect(screen.getByText('Hello')).toBeTruthy()
    })

    it('should render multiple children', () => {
      render(
        <DO ns="https://api.example.com/do/workspace">
          <div data-testid="child1">First</div>
          <div data-testid="child2">Second</div>
        </DO>
      )

      expect(screen.getByTestId('child1')).toBeTruthy()
      expect(screen.getByTestId('child2')).toBeTruthy()
    })

    it('should render nested children', () => {
      render(
        <DO ns="https://api.example.com/do/workspace">
          <div data-testid="parent">
            <span data-testid="nested">Nested</span>
          </div>
        </DO>
      )

      expect(screen.getByTestId('parent')).toBeTruthy()
      expect(screen.getByTestId('nested')).toBeTruthy()
    })
  })

  describe('provides context to hooks', () => {
    it('should provide context value with ns', () => {
      let contextValue: unknown = null

      function Consumer() {
        contextValue = React.useContext(DotdoContext)
        return null
      }

      render(
        <DO ns="https://api.example.com/do/workspace">
          <Consumer />
        </DO>
      )

      expect(contextValue).not.toBeNull()
      expect((contextValue as { ns: string }).ns).toBe('https://api.example.com/do/workspace')
    })

    it('should provide client in context', () => {
      let contextValue: unknown = null

      function Consumer() {
        contextValue = React.useContext(DotdoContext)
        return null
      }

      render(
        <DO ns="https://api.example.com/do/workspace">
          <Consumer />
        </DO>
      )

      expect((contextValue as { client: unknown }).client).not.toBeNull()
    })

    it('should provide connections map in context', () => {
      let contextValue: unknown = null

      function Consumer() {
        contextValue = React.useContext(DotdoContext)
        return null
      }

      render(
        <DO ns="https://api.example.com/do/workspace">
          <Consumer />
        </DO>
      )

      expect((contextValue as { connections: Map<string, WebSocket> }).connections).toBeInstanceOf(Map)
    })

    it('should provide getConnection function in context', () => {
      let contextValue: unknown = null

      function Consumer() {
        contextValue = React.useContext(DotdoContext)
        return null
      }

      render(
        <DO ns="https://api.example.com/do/workspace">
          <Consumer />
        </DO>
      )

      expect(typeof (contextValue as { getConnection: unknown }).getConnection).toBe('function')
    })
  })

  describe('creates client with ns URL', () => {
    it('should create client with the provided ns URL', () => {
      render(
        <DO ns="https://api.example.com/do/workspace">
          <div>Test</div>
        </DO>
      )

      expect(createClient).toHaveBeenCalledWith('https://api.example.com/do/workspace', undefined)
    })

    it('should pass config to createClient', () => {
      const config = { timeout: 5000, batching: true }

      render(
        <DO ns="https://api.example.com/do/workspace" config={config}>
          <div>Test</div>
        </DO>
      )

      expect(createClient).toHaveBeenCalledWith('https://api.example.com/do/workspace', config)
    })

    it('should only create client once on re-renders', () => {
      const { rerender } = render(
        <DO ns="https://api.example.com/do/workspace">
          <div>Test</div>
        </DO>
      )

      const callCount = (createClient as ReturnType<typeof vi.fn>).mock.calls.length

      rerender(
        <DO ns="https://api.example.com/do/workspace">
          <div>Test Updated</div>
        </DO>
      )

      // Client should not be created again
      expect((createClient as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount)
    })
  })

  describe('disconnects on unmount', () => {
    it('should call disconnect on client when unmounting', () => {
      const mockDisconnect = vi.fn()
      vi.mocked(createClient).mockReturnValue({
        connectionState: 'connected',
        disconnect: mockDisconnect,
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as ReturnType<typeof createClient>)

      const { unmount } = render(
        <DO ns="https://api.example.com/do/workspace">
          <div>Test</div>
        </DO>
      )

      unmount()

      expect(mockDisconnect).toHaveBeenCalled()
    })

    it('should close all WebSocket connections on unmount', () => {
      const mockClose = vi.fn()

      // Create a mock connection
      let contextValue: unknown = null

      function Consumer() {
        contextValue = React.useContext(DotdoContext)
        // Add a mock connection to the map
        if (contextValue) {
          const conn = new MockWebSocket('wss://test.com')
          conn.close = mockClose
          ;(contextValue as { connections: Map<string, WebSocket> }).connections.set('Task', conn as unknown as WebSocket)
        }
        return null
      }

      const { unmount } = render(
        <DO ns="https://api.example.com/do/workspace">
          <Consumer />
        </DO>
      )

      unmount()

      expect(mockClose).toHaveBeenCalled()
    })

    it('should clear connections map on unmount', () => {
      let contextValue: { connections: Map<string, WebSocket> } | null = null

      function Consumer() {
        contextValue = React.useContext(DotdoContext) as { connections: Map<string, WebSocket> }
        // Add a mock connection
        if (contextValue) {
          contextValue.connections.set('Task', new MockWebSocket('wss://test.com') as unknown as WebSocket)
        }
        return null
      }

      const { unmount } = render(
        <DO ns="https://api.example.com/do/workspace">
          <Consumer />
        </DO>
      )

      // Verify connection was added
      expect(contextValue?.connections.size).toBeGreaterThan(0)

      unmount()

      // Connections should be cleared after unmount
      expect(contextValue?.connections.size).toBe(0)
    })
  })
})
