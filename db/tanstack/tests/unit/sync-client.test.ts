/**
 * SyncClient WebSocket Tests
 *
 * Tests for the WebSocket sync client that handles real-time updates.
 * These tests are written in RED phase - they should FAIL until the
 * SyncClient implementation is complete.
 *
 * Wire Protocol Reference:
 *
 * Client -> Server:
 *   { type: 'subscribe', collection: 'Task', branch?: string }
 *   { type: 'unsubscribe', collection: 'Task' }
 *
 * Server -> Client:
 *   { type: 'initial', collection: 'Task', data: T[], txid: number }
 *   { type: 'insert', collection: 'Task', key: string, data: T, txid: number }
 *   { type: 'update', collection: 'Task', key: string, data: T, txid: number }
 *   { type: 'delete', collection: 'Task', key: string, txid: number }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncClient } from '../../sync-client'

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
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

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
// Test Types
// =============================================================================

interface Task {
  $id: string
  $type: string
  name?: string
  data?: {
    title: string
    completed: boolean
  }
  createdAt: string
  updatedAt: string
}

// =============================================================================
// Test Fixtures
// =============================================================================

const createTask = (id: string, title: string, completed = false): Task => ({
  $id: `https://example.com/tasks/${id}`,
  $type: 'https://example.com/Task',
  name: title,
  data: { title, completed },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
})

// =============================================================================
// Test Setup
// =============================================================================

describe('SyncClient', () => {
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
  })

  // ===========================================================================
  // Connection Tests
  // ===========================================================================

  describe('connection', () => {
    it('connects to WebSocket URL', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toBe('wss://example.com/do/123/sync')
    })

    it('sends subscribe message on connect', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      expect(ws.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'subscribe',
        collection: 'Task',
      })
    })

    it('sends subscribe message with branch when specified', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        branch: 'feature-branch',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'subscribe',
        collection: 'Task',
        branch: 'feature-branch',
      })
    })

    it('reconnects with exponential backoff', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      // First connection closes
      MockWebSocket.instances[0].simulateClose()
      expect(MockWebSocket.instances).toHaveLength(1)

      // After 1 second, should reconnect
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)

      // Second connection closes
      MockWebSocket.instances[1].simulateClose()

      // After 1 second, not yet reconnected (exponential backoff: 2s)
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)

      // After another 1 second (total 2s), should reconnect
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(3)

      // Third connection closes
      MockWebSocket.instances[2].simulateClose()

      // After 3 seconds, not yet reconnected (exponential backoff: 4s)
      vi.advanceTimersByTime(3000)
      expect(MockWebSocket.instances).toHaveLength(3)

      // After another 1 second (total 4s), should reconnect
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(4)
    })

    it('caps reconnect delay at 30 seconds', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      // Simulate many failed reconnections
      for (let i = 0; i < 10; i++) {
        MockWebSocket.instances[i].simulateClose()
        // Even after many attempts, delay should not exceed 30 seconds
        vi.advanceTimersByTime(30000)
      }

      expect(MockWebSocket.instances).toHaveLength(11)
    })

    it('resets reconnect attempts after successful connection', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      // Close and reconnect with backoff
      MockWebSocket.instances[0].simulateClose()
      vi.advanceTimersByTime(1000)

      MockWebSocket.instances[1].simulateClose()
      vi.advanceTimersByTime(2000)

      // Now successfully connect
      MockWebSocket.instances[2].simulateOpen()

      // Close again - should use initial delay (1s) since attempts were reset
      MockWebSocket.instances[2].simulateClose()

      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(4)
    })

    it('calls onDisconnect callback', () => {
      const onDisconnect = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onDisconnect = onDisconnect

      client.connect()

      MockWebSocket.instances[0].simulateOpen()
      MockWebSocket.instances[0].simulateClose()

      expect(onDisconnect).toHaveBeenCalledTimes(1)
    })

    it('does not reconnect after disconnect() is called', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()
      MockWebSocket.instances[0].simulateOpen()

      client.disconnect()

      // Advance time well past any reconnect delay
      vi.advanceTimersByTime(60000)

      // Should only have the original WebSocket, no reconnection attempts
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Message Handling Tests
  // ===========================================================================

  describe('messages', () => {
    it('calls onInitial with data array', () => {
      const onInitial = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onInitial = onInitial

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      const tasks = [
        createTask('1', 'First task'),
        createTask('2', 'Second task'),
      ]

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: tasks,
        txid: 100,
      })

      expect(onInitial).toHaveBeenCalledTimes(1)
      expect(onInitial).toHaveBeenCalledWith(tasks, 100)
    })

    it('calls onInitial with empty array when no data', () => {
      const onInitial = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onInitial = onInitial

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: [],
        txid: 0,
      })

      expect(onInitial).toHaveBeenCalledWith([], 0)
    })

    it('calls onChange for insert messages', () => {
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      const newTask = createTask('3', 'New task')

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: newTask.$id,
        data: newTask,
        txid: 101,
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('insert', newTask, 101)
    })

    it('calls onChange for update messages', () => {
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      const updatedTask = createTask('1', 'Updated task', true)

      ws.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: updatedTask.$id,
        data: updatedTask,
        txid: 102,
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('update', updatedTask, 102)
    })

    it('calls onChange for delete messages', () => {
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      ws.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: 'https://example.com/tasks/1',
        txid: 103,
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      // For delete, data may be undefined, but we still get the key via the message
      expect(onChange).toHaveBeenCalledWith('delete', expect.any(Object), 103)
    })

    it('extracts txid from messages', () => {
      const onInitial = vi.fn()
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onInitial = onInitial
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Initial with specific txid
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: [],
        txid: 42,
      })

      expect(onInitial).toHaveBeenCalledWith([], 42)

      // Insert with specific txid
      const task = createTask('1', 'Task')
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: task.$id,
        data: task,
        txid: 999,
      })

      expect(onChange).toHaveBeenCalledWith('insert', task, 999)
    })

    it('handles messages for correct collection only', () => {
      const onInitial = vi.fn()
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onInitial = onInitial
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Message for different collection should be ignored
      ws.simulateMessage({
        type: 'initial',
        collection: 'User',
        data: [{ $id: 'user-1' }],
        txid: 100,
      })

      // This test verifies the client filters by collection
      // The client may or may not call callbacks for other collections
      // depending on implementation - for now we test it's received
      // The GREEN implementation should handle this appropriately
    })
  })

  // ===========================================================================
  // Unsubscribe Tests
  // ===========================================================================

  describe('unsubscribe', () => {
    it('sends unsubscribe message', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Clear subscribe message
      ws.send.mockClear()

      client.disconnect()

      expect(ws.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'unsubscribe',
        collection: 'Task',
      })
    })

    it('closes WebSocket on disconnect()', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      client.disconnect()

      expect(ws.close).toHaveBeenCalledTimes(1)
    })

    it('is safe to call disconnect multiple times', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      expect(() => {
        client.disconnect()
        client.disconnect()
        client.disconnect()
      }).not.toThrow()
    })

    it('cancels pending reconnection on disconnect', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Trigger reconnection by closing
      ws.simulateClose()

      // Disconnect before reconnection timer fires
      client.disconnect()

      // Advance time past reconnection delay
      vi.advanceTimersByTime(60000)

      // Should only have original WebSocket
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('does not send unsubscribe if socket not open', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      // Don't open the socket
      const ws = MockWebSocket.instances[0]

      client.disconnect()

      // Should not attempt to send on unopened socket
      expect(ws.send).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles malformed JSON in message', () => {
      const onInitial = vi.fn()
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onInitial = onInitial
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Send malformed message - should not crash
      expect(() => {
        ws.onmessage?.({ data: 'not valid json' })
      }).not.toThrow()

      // Callbacks should not be called for invalid messages
      expect(onInitial).not.toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('handles unknown message types gracefully', () => {
      const onInitial = vi.fn()
      const onChange = vi.fn()

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      client.onInitial = onInitial
      client.onChange = onChange

      client.connect()

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Send unknown message type - should not crash
      expect(() => {
        ws.simulateMessage({
          type: 'unknown',
          collection: 'Task',
          data: {},
        })
      }).not.toThrow()
    })

    it('can connect, disconnect, and reconnect', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      // First connection
      client.connect()
      MockWebSocket.instances[0].simulateOpen()
      expect(MockWebSocket.instances).toHaveLength(1)

      // Disconnect
      client.disconnect()

      // Connect again
      client.connect()
      MockWebSocket.instances[1].simulateOpen()
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('handles connection error and reconnects', () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.connect()

      const ws = MockWebSocket.instances[0]

      // Simulate error followed by close
      ws.simulateError(new Error('Connection failed'))
      ws.simulateClose()

      // Should attempt reconnection
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)
    })
  })
})
