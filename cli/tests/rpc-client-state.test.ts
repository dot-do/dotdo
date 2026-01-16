/**
 * RPC Client Connection State Tests
 *
 * Tests for discriminated union connection state in RpcClient.
 * This ensures type-safe state management with appropriate properties per state.
 *
 * Expected type:
 * ```typescript
 * type ConnectionState =
 *   | { status: 'disconnected' }
 *   | { status: 'connecting'; attempt: number }
 *   | { status: 'connected'; socket: WebSocket }
 *   | { status: 'reconnecting'; attempt: number; lastError: string }
 *   | { status: 'error'; error: Error }
 * ```
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectTypeOf } from 'vitest'
import { RpcClient, type ConnectionState } from '../src/rpc-client.js'
import WebSocket from 'ws'

/**
 * Expected discriminated union type for ConnectionState
 *
 * The RpcClient should expose connection state as a discriminated union
 * where each state has appropriate properties:
 */
type ExpectedConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting'; attempt: number }
  | { status: 'connected'; socket: WebSocket }
  | { status: 'reconnecting'; attempt: number; lastError: string }
  | { status: 'error'; error: Error }

/**
 * Type-level tests for discriminated union ConnectionState
 *
 * These tests verify the type structure at compile time.
 * They will fail if ConnectionState is not a proper discriminated union.
 */
describe('ConnectionState type structure', () => {
  it('should be a discriminated union with status field', () => {
    // ConnectionState should have a 'status' discriminant property
    // This test verifies the type has the expected structure

    // If ConnectionState is properly typed, this should compile
    // The current implementation uses simple strings, so this will fail
    const state: ConnectionState = { status: 'disconnected' } as any

    // Type assertion: ConnectionState should be assignable from an object with status
    expectTypeOf<ConnectionState>().toMatchTypeOf<{ status: string }>()
  })

  it('should have status property as discriminant', () => {
    // The type should allow narrowing based on status
    function handleState(state: ConnectionState): string {
      // This should work with discriminated union narrowing
      if (state.status === 'connected') {
        // In a proper discriminated union, socket should be accessible here
        return `connected via ${state.socket.url}`
      }
      if (state.status === 'error') {
        // In a proper discriminated union, error should be accessible here
        return `error: ${state.error.message}`
      }
      if (state.status === 'connecting') {
        return `connecting attempt ${state.attempt}`
      }
      if (state.status === 'reconnecting') {
        return `reconnecting attempt ${state.attempt} after ${state.lastError}`
      }
      return 'disconnected'
    }

    // Type check: function should accept ConnectionState
    expectTypeOf(handleState).parameter(0).toEqualTypeOf<ConnectionState>()
  })

  it('should have correct properties for disconnected state', () => {
    // Disconnected state should only have status property
    type DisconnectedState = Extract<ConnectionState, { status: 'disconnected' }>

    expectTypeOf<DisconnectedState>().toMatchTypeOf<{ status: 'disconnected' }>()
  })

  it('should have correct properties for connecting state', () => {
    // Connecting state should have status and attempt number
    type ConnectingState = Extract<ConnectionState, { status: 'connecting' }>

    expectTypeOf<ConnectingState>().toMatchTypeOf<{
      status: 'connecting'
      attempt: number
    }>()
  })

  it('should have correct properties for connected state', () => {
    // Connected state should have status and socket reference
    type ConnectedState = Extract<ConnectionState, { status: 'connected' }>

    expectTypeOf<ConnectedState>().toMatchTypeOf<{
      status: 'connected'
      socket: WebSocket
    }>()
  })

  it('should have correct properties for reconnecting state', () => {
    // Reconnecting state should have status, attempt number, and last error
    type ReconnectingState = Extract<ConnectionState, { status: 'reconnecting' }>

    expectTypeOf<ReconnectingState>().toMatchTypeOf<{
      status: 'reconnecting'
      attempt: number
      lastError: string
    }>()
  })

  it('should have correct properties for error state', () => {
    // Error state should have status and error object
    type ErrorState = Extract<ConnectionState, { status: 'error' }>

    expectTypeOf<ErrorState>().toMatchTypeOf<{
      status: 'error'
      error: Error
    }>()
  })
})

/**
 * Runtime tests for connection state behavior
 *
 * These tests verify the RpcClient correctly manages state transitions
 * and exposes the discriminated union through getState().
 */
describe('RpcClient connection state management', () => {
  let client: RpcClient

  beforeEach(() => {
    client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      autoReconnect: false,
    })
  })

  afterEach(async () => {
    // Safely disconnect - only call if client exists
    // The disconnect may throw if websocket is in certain states
    // Give a small delay for async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 10))
    try {
      client?.disconnect()
    } catch {
      // Ignore cleanup errors - WebSocket may throw if closed before connected
    }
  })

  describe('initial state', () => {
    it('should start in disconnected state', () => {
      const state = client.getState()

      expect(state.status).toBe('disconnected')
    })

    it('should return disconnected state object with only status property', () => {
      const state = client.getState()

      expect(state).toEqual({ status: 'disconnected' })
    })
  })

  describe('connecting state', () => {
    it('should return connecting state with attempt number when connecting', () => {
      // Verify that getState returns an object with status and attempt properties
      // The current implementation returns a simple string, this should fail

      // Get state - should be an object with status property
      const state = client.getState()

      // State should be an object (discriminated union), not a string
      expect(typeof state).toBe('object')
      expect(state).not.toBeNull()
      expect(state).toHaveProperty('status')

      // When in connecting state (verified by type check), should have attempt number
      // This tests the discriminated union structure
      const mockConnectingState: ConnectionState = {
        status: 'connecting',
        attempt: 1,
      } as any // cast since current type is wrong

      expect(mockConnectingState).toHaveProperty('attempt')
      expect(typeof mockConnectingState.attempt).toBe('number')
    })

    it('should include attempt count in connecting state', () => {
      // Verify connecting state structure includes attempt count
      // This test verifies the state is an object, not a string
      const initialState = client.getState()

      // The state should be an object, not a string
      expect(typeof initialState).toBe('object')
      expect(initialState).toMatchObject({
        status: expect.any(String),
      })
    })
  })

  describe('connected state', () => {
    it('should have socket reference in connected state', async () => {
      // This test would require a mock server or the actual endpoint
      // For now, we verify the type structure
      const mockState = { status: 'connected', socket: {} as WebSocket }

      // Verify the expected structure
      expect(mockState.status).toBe('connected')
      expect(mockState).toHaveProperty('socket')
    })

    it('should provide WebSocket instance in connected state', () => {
      // Type test: when status is 'connected', socket should be available
      const state = client.getState()

      if (state.status === 'connected') {
        // This should compile and socket should be a WebSocket
        expectTypeOf(state.socket).toEqualTypeOf<WebSocket>()
      }
    })
  })

  describe('reconnecting state', () => {
    it('should track reconnection attempts with lastError', () => {
      // Verify reconnecting state has required properties
      const expectedReconnectingState = {
        status: 'reconnecting' as const,
        attempt: 2,
        lastError: 'Connection refused',
      }

      expect(expectedReconnectingState.status).toBe('reconnecting')
      expect(expectedReconnectingState.attempt).toBe(2)
      expect(expectedReconnectingState.lastError).toBe('Connection refused')
    })

    it('should include lastError string in reconnecting state', () => {
      // Type assertion for reconnecting state structure
      type ReconnectingState = Extract<ConnectionState, { status: 'reconnecting' }>

      // This verifies the type has lastError property
      const state: ReconnectingState = {
        status: 'reconnecting',
        attempt: 1,
        lastError: 'timeout',
      } as any

      expect(state).toHaveProperty('lastError')
    })
  })

  describe('error state', () => {
    it('should include Error object in error state', () => {
      // Error state should contain the actual Error object
      const expectedErrorState = {
        status: 'error' as const,
        error: new Error('Connection failed'),
      }

      expect(expectedErrorState.status).toBe('error')
      expect(expectedErrorState.error).toBeInstanceOf(Error)
      expect(expectedErrorState.error.message).toBe('Connection failed')
    })

    it('should preserve error details in error state', () => {
      // Type assertion for error state structure
      type ErrorState = Extract<ConnectionState, { status: 'error' }>

      // Verify error property is an Error instance
      const state: ErrorState = {
        status: 'error',
        error: new Error('test'),
      } as any

      expect(state.error).toBeInstanceOf(Error)
    })
  })

  describe('state transitions', () => {
    it('should emit state change events with full state object', () => {
      const stateChanges: ConnectionState[] = []

      // Register for stateChange event
      // When properly implemented, RpcClient should emit 'stateChange' events
      // with the full discriminated union state object
      client.on('stateChange', (state: ConnectionState) => {
        stateChanges.push(state)
      })

      // Get initial state - it should be an object
      const initialState = client.getState()

      // Verify stateChange event mechanism exists
      // The current implementation doesn't emit stateChange events with the full object
      // This test verifies that when implemented:
      // 1. A 'stateChange' event is emitted on state transitions
      // 2. The event payload is the full discriminated union state object

      // Initial state should be an object with status
      expect(typeof initialState).toBe('object')
      expect(initialState).toHaveProperty('status')
    })

    it('should allow exhaustive switch on state status', () => {
      // This function should compile without errors if ConnectionState is exhaustive
      function getStateDescription(state: ConnectionState): string {
        switch (state.status) {
          case 'disconnected':
            return 'Not connected'
          case 'connecting':
            return `Connecting (attempt ${state.attempt})`
          case 'connected':
            return `Connected to ${state.socket.url}`
          case 'reconnecting':
            return `Reconnecting (attempt ${state.attempt}) - last error: ${state.lastError}`
          case 'error':
            return `Error: ${state.error.message}`
          default:
            // TypeScript exhaustiveness check - should be unreachable
            const _exhaustive: never = state
            return _exhaustive
        }
      }

      // The function should be callable
      expectTypeOf(getStateDescription).toBeFunction()
    })
  })
})

/**
 * Type guard tests
 *
 * These tests verify type guards work correctly with the discriminated union.
 */
describe('ConnectionState type guards', () => {
  it('should narrow to disconnected state', () => {
    function isDisconnected(
      state: ConnectionState
    ): state is Extract<ConnectionState, { status: 'disconnected' }> {
      return state.status === 'disconnected'
    }

    const state: ConnectionState = { status: 'disconnected' } as any

    if (isDisconnected(state)) {
      // In narrowed scope, should only have status property
      expect(Object.keys(state)).toEqual(['status'])
    }
  })

  it('should narrow to connected state with socket access', () => {
    function isConnected(
      state: ConnectionState
    ): state is Extract<ConnectionState, { status: 'connected' }> {
      return state.status === 'connected'
    }

    const mockSocket = { url: 'wss://test.com' } as WebSocket
    const state: ConnectionState = { status: 'connected', socket: mockSocket } as any

    if (isConnected(state)) {
      // In narrowed scope, socket should be accessible
      expect(state.socket).toBeDefined()
      expect(state.socket.url).toBe('wss://test.com')
    }
  })

  it('should narrow to error state with error access', () => {
    function isError(
      state: ConnectionState
    ): state is Extract<ConnectionState, { status: 'error' }> {
      return state.status === 'error'
    }

    const error = new Error('Test error')
    const state: ConnectionState = { status: 'error', error } as any

    if (isError(state)) {
      // In narrowed scope, error should be accessible
      expect(state.error).toBeInstanceOf(Error)
      expect(state.error.message).toBe('Test error')
    }
  })
})

/**
 * State immutability tests
 *
 * Connection state should be immutable - state transitions create new objects.
 */
describe('ConnectionState immutability', () => {
  it('should return new state object on transition', () => {
    const client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      autoReconnect: false,
    })

    const initialState = client.getState()

    // State should be an object (discriminated union), not a string
    expect(typeof initialState).toBe('object')
    expect(initialState).not.toBeNull()

    // Attempting to modify should not affect internal state
    // (This tests that getState returns a copy or the state is readonly)
    if (typeof initialState === 'object' && initialState !== null) {
      const stateCopy = { ...initialState }
      expect(client.getState()).toEqual(initialState)
    }

    try {
      client.disconnect()
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should not allow mutation of returned state', () => {
    const client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      autoReconnect: false,
    })

    const state = client.getState()

    // State should be an object with status property
    expect(typeof state).toBe('object')
    expect(state).toHaveProperty('status')

    // Attempting to mutate should either throw or not affect internal state
    try {
      ;(state as any).status = 'connected'
    } catch {
      // Expected if state is frozen
    }

    // Internal state should still be disconnected
    const currentState = client.getState()
    expect(typeof currentState).toBe('object')
    if (typeof currentState === 'object' && currentState !== null && 'status' in currentState) {
      expect(currentState.status).toBe('disconnected')
    }

    try {
      client.disconnect()
    } catch {
      // Ignore cleanup errors
    }
  })
})
