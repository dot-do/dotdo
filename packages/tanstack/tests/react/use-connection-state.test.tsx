/**
 * Tests for useConnectionState hook
 *
 * RED phase: Tests define the useConnectionState contract
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import * as React from 'react'
import { SyncProvider } from '../../src/react/provider'
import { useConnectionState } from '../../src/react/use-connection-state'

// WebSocket mock
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

  simulateError() {
    this.emit('error', new Event('error'))
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close'))
  }
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider doUrl="https://api.example.com/do/workspace">
      {children}
    </SyncProvider>
  )
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

describe('useConnectionState', () => {
  it('should return status from context', async () => {
    let hookResult: ReturnType<typeof useConnectionState> | null = null

    function TestComponent() {
      hookResult = useConnectionState()
      return null
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    expect(hookResult!.status).toBeDefined()
    expect(['connecting', 'connected', 'reconnecting', 'error']).toContain(hookResult!.status)
  })

  it('should return reconnectAttempts from context', () => {
    let hookResult: ReturnType<typeof useConnectionState> | null = null

    function TestComponent() {
      hookResult = useConnectionState()
      return null
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    expect(typeof hookResult!.reconnectAttempts).toBe('number')
    expect(hookResult!.reconnectAttempts).toBe(0)
  })

  it('should return lastSyncAt from context', () => {
    let hookResult: ReturnType<typeof useConnectionState> | null = null

    function TestComponent() {
      hookResult = useConnectionState()
      return null
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    expect(hookResult!.lastSyncAt).toBeNull()
  })

  it('should update when connection state changes', async () => {
    let hookResult: ReturnType<typeof useConnectionState> | null = null

    function TestComponent() {
      hookResult = useConnectionState()
      return <div data-testid="status">{hookResult.status}</div>
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    expect(hookResult!.status).toBe('connecting')

    // Wait for connection
    await waitFor(() => {
      expect(hookResult!.status).toBe('connected')
    })
  })

  it('should show reconnecting status after disconnect', async () => {
    let hookResult: ReturnType<typeof useConnectionState> | null = null

    function TestComponent() {
      hookResult = useConnectionState()
      return null
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0)
    })

    const ws = MockWebSocket.instances[0]

    await act(async () => {
      ws.simulateClose()
    })

    expect(hookResult!.status).toBe('reconnecting')
  })

  it('should show error status after WebSocket error', async () => {
    let hookResult: ReturnType<typeof useConnectionState> | null = null

    function TestComponent() {
      hookResult = useConnectionState()
      return null
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0)
    })

    const ws = MockWebSocket.instances[0]

    await act(async () => {
      ws.simulateError()
    })

    expect(hookResult!.status).toBe('error')
  })

  it('should throw when used outside SyncProvider', () => {
    function TestComponent() {
      useConnectionState()
      return null
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<TestComponent />)
    }).toThrow('useSyncContext must be used within a SyncProvider')

    consoleSpy.mockRestore()
  })
})
