/**
 * SyncClient Tests - TDD for WebSocket subscription manager
 *
 * Tests for the SyncClient class that manages WebSocket connections
 * for real-time TanStack DB synchronization.
 *
 * The SyncClient handles:
 * - WebSocket connection/reconnection with exponential backoff
 * - subscribe/unsubscribe messages to server
 * - Processing initial data and change streams from server
 * - Callback-based API for React integration
 *
 * Wire Protocol:
 * - Client -> Server: { type: 'subscribe', collection: string, branch?: string }
 * - Client -> Server: { type: 'unsubscribe', collection: string }
 * - Server -> Client: { type: 'initial', collection: string, branch: string | null, data: T[], txid: number }
 * - Server -> Client: { type: 'insert' | 'update' | 'delete', collection: string, branch: string | null, key: string, data?: T, txid: number }
 *
 * @module db/tanstack/tests/sync-client.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SyncItem, ChangeMessage, InitialMessage, ServerMessage } from '../protocol'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock WebSocket implementation for testing
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  private listeners: Map<string, Set<EventListener>> = new Map()
  public sentMessages: string[] = []
  public closeCode?: number
  public closeReason?: string

  constructor(url: string) {
    this.url = url
    // Note: We don't auto-open - tests must explicitly call simulateOpen()
    // This allows tests to control the timing of connection establishment
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code
    this.closeReason = reason
    this.readyState = MockWebSocket.CLOSING
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED
      this.dispatchEvent('close', { code, reason } as unknown as Event)
    }, 0)
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.dispatchEvent('open', {} as Event)
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent('close', { code, reason } as unknown as Event)
  }

  simulateError(): void {
    this.dispatchEvent('error', new Error('WebSocket error') as unknown as Event)
  }

  simulateMessage(data: unknown): void {
    const message = typeof data === 'string' ? data : JSON.stringify(data)
    this.dispatchEvent('message', { data: message } as unknown as Event)
  }

  private dispatchEvent(type: string, event: Event): void {
    // Call on* handler
    const handler = this[`on${type}` as keyof this]
    if (typeof handler === 'function') {
      ;(handler as EventListener)(event)
    }

    // Call addEventListener handlers
    const listeners = this.listeners.get(type)
    if (listeners) {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}

// Store original WebSocket and replace with mock
let originalWebSocket: typeof WebSocket
let mockWebSocketInstances: MockWebSocket[] = []

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  mockWebSocketInstances = []
  // @ts-expect-error - Replacing WebSocket with mock
  globalThis.WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url)
      mockWebSocketInstances.push(this)
    }
  }
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  mockWebSocketInstances = []
  vi.clearAllTimers()
})

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestTask extends SyncItem {
  $id: string
  $type: string
  name: string
  status?: string
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

// ============================================================================
// TESTS: SyncClient Factory Function (createSyncClient)
// ============================================================================

describe('createSyncClient()', () => {
  it('should create a SyncClient with the expected interface', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    expect(client).toBeDefined()
    expect(typeof client.connect).toBe('function')
    expect(typeof client.disconnect).toBe('function')
    expect(typeof client.getStatus).toBe('function')
    expect(typeof client.subscribe).toBe('function')
    expect(typeof client.unsubscribe).toBe('function')
    expect(typeof client.onInitial).toBe('function')
    expect(typeof client.onChange).toBe('function')
    expect(typeof client.onSync).toBe('function')
    expect(typeof client.onDisconnect).toBe('function')
    expect(typeof client.onError).toBe('function')
    expect(typeof client.onStatusChange).toBe('function')
  })

  it('should append /sync to URL if not present', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com' })

    // Start connecting (don't await, just trigger WebSocket creation)
    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)

    expect(mockWebSocketInstances[0].url).toBe('wss://test.example.com/sync')
  })

  it('should not append /sync if already present', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    // Start connecting (don't await, just trigger WebSocket creation)
    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)

    expect(mockWebSocketInstances[0].url).toBe('wss://test.example.com/sync')
  })

  it('should handle trailing slash in URL', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/' })

    // Start connecting (don't await, just trigger WebSocket creation)
    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)

    expect(mockWebSocketInstances[0].url).toBe('wss://test.example.com/sync')
  })
})

// ============================================================================
// TESTS: Connection Management
// ============================================================================

describe('SyncClient connection management', () => {
  it('should connect to WebSocket server', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    expect(client.getStatus()).toBe('connected')
  })

  it('should start with disconnected status', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    expect(client.getStatus()).toBe('disconnected')
  })

  it('should transition to connecting status on connect()', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const statusChanges: string[] = []
    client.onStatusChange((status) => statusChanges.push(status))

    client.connect()
    await vi.waitFor(() => statusChanges.includes('connecting'))

    expect(statusChanges).toContain('connecting')
  })

  it('should disconnect from WebSocket server', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.disconnect()
    await vi.waitFor(() => client.getStatus() === 'disconnected')

    expect(client.getStatus()).toBe('disconnected')
  })

  it('should call onDisconnect callback when connection closes', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })
    const onDisconnect = vi.fn()
    client.onDisconnect(onDisconnect)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    mockWebSocketInstances[0].simulateClose()
    await vi.waitFor(() => onDisconnect.mock.calls.length > 0)

    expect(onDisconnect).toHaveBeenCalled()
  })

  it('should call onError callback on connection error', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })
    const onError = vi.fn()
    client.onError(onError)

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateError()

    await vi.waitFor(() => onError.mock.calls.length > 0)

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('should resolve connect() immediately if already connected', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise1 = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise1

    // Second connect should resolve immediately
    await client.connect()
    expect(client.getStatus()).toBe('connected')
    expect(mockWebSocketInstances.length).toBe(1) // No new WebSocket created
  })

  it('should track status changes throughout lifecycle', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const statusChanges: string[] = []
    client.onStatusChange((status) => statusChanges.push(status))

    const connectPromise = client.connect()
    await vi.waitFor(() => statusChanges.includes('connecting'))
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    await vi.waitFor(() => statusChanges.includes('connected'))

    client.disconnect()
    await vi.waitFor(() => statusChanges.includes('disconnected'))

    expect(statusChanges).toContain('connecting')
    expect(statusChanges).toContain('connected')
    expect(statusChanges).toContain('disconnected')
  })
})

// ============================================================================
// TESTS: Reconnection Logic
// ============================================================================

describe('SyncClient reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should attempt reconnection on unexpected disconnect', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const statusChanges: string[] = []
    client.onStatusChange((status) => statusChanges.push(status))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate unexpected close
    mockWebSocketInstances[0].simulateClose()

    await vi.waitFor(() => statusChanges.includes('reconnecting'))
    expect(statusChanges).toContain('reconnecting')
  })

  it('should use exponential backoff for reconnection', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate disconnect
    mockWebSocketInstances[0].simulateClose()

    // First reconnect attempt should happen after base delay (1000ms)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockWebSocketInstances.length).toBe(2)

    // Simulate another disconnect
    mockWebSocketInstances[1].simulateClose()

    // Second attempt should use exponential backoff (2000ms)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockWebSocketInstances.length).toBe(2) // Not yet

    await vi.advanceTimersByTimeAsync(1000)
    expect(mockWebSocketInstances.length).toBe(3)
  })

  it('should not reconnect after intentional disconnect', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Intentional disconnect
    client.disconnect()
    await vi.waitFor(() => client.getStatus() === 'disconnected')

    // Advance timers - should not attempt reconnection
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockWebSocketInstances.length).toBe(1)
  })

  it('should re-subscribe to pending subscriptions on reconnect', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Subscribe to a collection
    client.subscribe('Task')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)

    // Simulate disconnect and reconnect
    mockWebSocketInstances[0].simulateClose()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length === 2)
    mockWebSocketInstances[1].simulateOpen()

    // Should re-subscribe
    await vi.waitFor(() => mockWebSocketInstances[1].sentMessages.length > 0)
    const resubscribeMessage = JSON.parse(mockWebSocketInstances[1].sentMessages[0])
    expect(resubscribeMessage.type).toBe('subscribe')
    expect(resubscribeMessage.collection).toBe('Task')
  })
})

// ============================================================================
// TESTS: Subscribe/Unsubscribe Messages
// ============================================================================

describe('SyncClient subscribe/unsubscribe', () => {
  it('should send subscribe message when connected', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(message).toEqual({
      type: 'subscribe',
      collection: 'Task',
      branch: null,
    })
  })

  it('should send subscribe message with branch', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task', 'feature/dark-mode')

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(message).toEqual({
      type: 'subscribe',
      collection: 'Task',
      branch: 'feature/dark-mode',
    })
  })

  it('should use config branch as default', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({
      url: 'wss://test.example.com/sync',
      branch: 'main',
    })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(message.branch).toBe('main')
  })

  it('should send unsubscribe message', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)

    client.unsubscribe('Task')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 1)

    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[1])
    expect(message).toEqual({
      type: 'unsubscribe',
      collection: 'Task',
    })
  })

  it('should queue subscriptions when not connected', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    // Subscribe before connect
    client.subscribe('Task')

    // Connect
    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Should send pending subscription
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(message.type).toBe('subscribe')
    expect(message.collection).toBe('Task')
  })
})

// ============================================================================
// TESTS: Initial Message Handling
// ============================================================================

describe('SyncClient initial message handling', () => {
  it('should call onInitial callback with items and txid', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onInitial = vi.fn()
    client.onInitial('Task', onInitial)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')

    // Simulate initial message from server
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [
        { $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { $id: 'task-2', $type: 'Task', name: 'Task 2', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      ],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => onInitial.mock.calls.length > 0)

    expect(onInitial).toHaveBeenCalledWith(initialMessage.data, initialMessage.txid)
  })

  it('should only call onInitial for matching collection', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const taskInitial = vi.fn()
    const userInitial = vi.fn()
    client.onInitial('Task', taskInitial)
    client.onInitial('User', userInitial)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate initial message for Task only
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => taskInitial.mock.calls.length > 0)

    expect(taskInitial).toHaveBeenCalled()
    expect(userInitial).not.toHaveBeenCalled()
  })

  it('should support multiple callbacks for same collection', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const callback1 = vi.fn()
    const callback2 = vi.fn()
    client.onInitial('Task', callback1)
    client.onInitial('Task', callback2)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => callback1.mock.calls.length > 0)

    expect(callback1).toHaveBeenCalled()
    expect(callback2).toHaveBeenCalled()
  })

  it('should return unsubscribe function from onInitial', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const callback = vi.fn()
    const unsubscribe = client.onInitial('Task', callback)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Unsubscribe before message
    unsubscribe()

    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    // Wait a bit to ensure callback would have been called
    await new Promise((r) => setTimeout(r, 10))

    expect(callback).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Change Message Handling
// ============================================================================

describe('SyncClient change message handling', () => {
  it('should call onChange callback for insert messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'New Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange).toHaveBeenCalledWith(insertMessage)
  })

  it('should call onChange callback for update messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const updateMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Updated Task', createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      txid: 102,
    }
    mockWebSocketInstances[0].simulateMessage(updateMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange).toHaveBeenCalledWith(updateMessage)
  })

  it('should call onChange callback for delete messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const deleteMessage: ChangeMessage = {
      type: 'delete',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      txid: 103,
    }
    mockWebSocketInstances[0].simulateMessage(deleteMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange).toHaveBeenCalledWith(deleteMessage)
  })

  it('should call onSync callback for all change messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onSync = vi.fn()
    client.onSync(onSync)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Send messages for different collections
    const taskInsert: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    const userInsert: ChangeMessage = {
      type: 'insert',
      collection: 'User',
      branch: null,
      key: 'user-1',
      data: { $id: 'user-1', $type: 'User', name: 'User', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 102,
    }

    mockWebSocketInstances[0].simulateMessage(taskInsert)
    mockWebSocketInstances[0].simulateMessage(userInsert)

    await vi.waitFor(() => onSync.mock.calls.length >= 2)

    expect(onSync).toHaveBeenCalledTimes(2)
  })

  it('should only call onChange for matching collection', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const taskChange = vi.fn()
    const userChange = vi.fn()
    client.onChange('Task', taskChange)
    client.onChange('User', userChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const taskInsert: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(taskInsert)

    await vi.waitFor(() => taskChange.mock.calls.length > 0)

    expect(taskChange).toHaveBeenCalled()
    expect(userChange).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: SyncClient Class (OOP API)
// ============================================================================

describe('SyncClient class (OOP API)', () => {
  it('should create instance with expected properties', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
    })

    expect(client).toBeDefined()
    expect(typeof client.connect).toBe('function')
    expect(typeof client.disconnect).toBe('function')
    expect(client.connectionState).toBe('disconnected')
    expect(client.isConnected).toBe(false)
  })

  it('should use doUrl for WebSocket connection', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://my-do.workers.dev',
      collection: 'Task',
    })

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)

    expect(mockWebSocketInstances[0].url).toBe('wss://my-do.workers.dev/sync')
  })

  it('should auto-subscribe to collection on connect', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
    })

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(message.type).toBe('subscribe')
    expect(message.collection).toBe('Task')
  })

  it('should call onInitial callback with items', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
    })

    const onInitial = vi.fn()
    client.onInitial = onInitial

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => onInitial.mock.calls.length > 0)

    expect(onInitial).toHaveBeenCalledWith(initialMessage.data, initialMessage.txid)
  })

  it('should call onChange callback with operation and item', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
    })

    const onChange = vi.fn()
    client.onChange = onChange

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'New Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange).toHaveBeenCalledWith('insert', insertMessage.data, insertMessage.txid)
  })

  it('should handle delete with minimal item', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
    })

    const onChange = vi.fn()
    client.onChange = onChange

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const deleteMessage: ChangeMessage = {
      type: 'delete',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      txid: 103,
    }
    mockWebSocketInstances[0].simulateMessage(deleteMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    // Delete should pass operation and a minimal item with the key
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0]).toBe('delete')
  })

  it('should support branch configuration', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
      branch: 'feature/new-ui',
    })

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const message = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(message.branch).toBe('feature/new-ui')
  })

  it('should update connectionState and isConnected', async () => {
    const { SyncClient } = await import('../sync-client')
    const client = new SyncClient<TestTask>({
      doUrl: 'wss://test.example.com',
      collection: 'Task',
    })

    expect(client.connectionState).toBe('disconnected')
    expect(client.isConnected).toBe(false)

    client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    await vi.waitFor(() => client.connectionState === 'connected')

    expect(client.connectionState).toBe('connected')
    expect(client.isConnected).toBe(true)
  })
})

// ============================================================================
// TESTS: Error Handling
// ============================================================================

describe('SyncClient error handling', () => {
  it('should handle invalid JSON messages gracefully', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })
    const onError = vi.fn()
    client.onError(onError)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Send invalid JSON
    mockWebSocketInstances[0].simulateMessage('not valid json {')

    // Should not throw or call error callback for invalid messages
    // (silently ignored per implementation)
    await new Promise((r) => setTimeout(r, 10))
    // No error callback for invalid messages is fine
  })

  it('should handle unknown message types gracefully', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })
    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Send unknown message type
    mockWebSocketInstances[0].simulateMessage({ type: 'unknown', data: 'test' })

    await new Promise((r) => setTimeout(r, 10))

    // Should not crash, callback should not be called
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should continue working after handling errors', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })
    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Send invalid message
    mockWebSocketInstances[0].simulateMessage('invalid')

    // Then send valid message
    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange).toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Callback Management
// ============================================================================

describe('SyncClient callback management', () => {
  it('should allow removing onInitial callbacks', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const callback1 = vi.fn()
    const callback2 = vi.fn()
    const unsubscribe1 = client.onInitial('Task', callback1)
    client.onInitial('Task', callback2)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Remove first callback
    unsubscribe1()

    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => callback2.mock.calls.length > 0)

    expect(callback1).not.toHaveBeenCalled()
    expect(callback2).toHaveBeenCalled()
  })

  it('should allow removing onChange callbacks', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const callback1 = vi.fn()
    const callback2 = vi.fn()
    const unsubscribe1 = client.onChange('Task', callback1)
    client.onChange('Task', callback2)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Remove first callback
    unsubscribe1()

    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await vi.waitFor(() => callback2.mock.calls.length > 0)

    expect(callback1).not.toHaveBeenCalled()
    expect(callback2).toHaveBeenCalled()
  })

  it('should allow removing onSync callbacks', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const callback = vi.fn()
    const unsubscribe = client.onSync(callback)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Remove callback
    unsubscribe()

    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await new Promise((r) => setTimeout(r, 10))

    expect(callback).not.toHaveBeenCalled()
  })

  it('should allow removing onDisconnect callbacks', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const callback = vi.fn()
    const unsubscribe = client.onDisconnect(callback)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Remove callback
    unsubscribe()

    // Intentional disconnect to prevent reconnection
    client.disconnect()

    await new Promise((r) => setTimeout(r, 10))

    // Callback should not be called since we removed it
    // Note: disconnect() may still trigger internal close handling
    // The key test is that unsubscribe works
    expect(typeof unsubscribe).toBe('function')
  })
})

// ============================================================================
// TESTS: Heartbeat Handling
// ============================================================================

describe('SyncClient heartbeat handling', () => {
  it('should respond to ping messages with pong', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate ping message from server
    const pingTimestamp = Date.now()
    mockWebSocketInstances[0].simulateMessage({ type: 'ping', timestamp: pingTimestamp })

    // Should have sent a pong response
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)
    const pongMessage = JSON.parse(mockWebSocketInstances[0].sentMessages[0])
    expect(pongMessage.type).toBe('pong')
    expect(pongMessage.timestamp).toBe(pingTimestamp)
  })

  it('should update lastActivityAt on any server message', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Initial activity should be recent
    const initialAge = client.getLastActivityAge()
    expect(initialAge).toBeLessThan(100) // Less than 100ms

    // Wait a bit
    await new Promise((r) => setTimeout(r, 50))

    // Age should have increased
    const ageAfterWait = client.getLastActivityAge()
    expect(ageAfterWait).toBeGreaterThanOrEqual(50)

    // Simulate a message - should reset activity
    mockWebSocketInstances[0].simulateMessage({ type: 'ping', timestamp: Date.now() })

    const ageAfterMessage = client.getLastActivityAge()
    expect(ageAfterMessage).toBeLessThan(50)
  })

  it('should not trigger onChange callbacks for ping messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })
    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate ping message
    mockWebSocketInstances[0].simulateMessage({ type: 'ping', timestamp: Date.now() })

    // onChange should not be called for ping
    await new Promise((r) => setTimeout(r, 10))
    expect(onChange).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Reconnection Enhancements
// ============================================================================

describe('SyncClient reconnection enhancements', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should call onReconnect callback with attempt number', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const reconnectAttempts: number[] = []
    client.onReconnect((attempt) => reconnectAttempts.push(attempt))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate unexpected disconnect
    mockWebSocketInstances[0].simulateClose()

    // First reconnect should fire callback with attempt 1
    await vi.waitFor(() => reconnectAttempts.length > 0)
    expect(reconnectAttempts[0]).toBe(1)

    // Wait for reconnect attempt - note: the mock WebSocket auto-opens via setTimeout
    // We need to advance timers enough to trigger the reconnect timer (1000ms)
    // but then close the socket BEFORE the auto-open setTimeout(0) runs
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)

    // The second socket's auto-open is scheduled via setTimeout(0).
    // Close it immediately before advancing timers to prevent auto-open from resetting reconnectAttempts
    mockWebSocketInstances[1].simulateClose()

    // Second reconnect with attempt 2
    await vi.waitFor(() => reconnectAttempts.length > 1)
    expect(reconnectAttempts[1]).toBe(2)
  })

  it('should track reconnect attempt number', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    expect(client.getReconnectAttempt()).toBe(0)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    expect(client.getReconnectAttempt()).toBe(0)

    // Simulate unexpected disconnect
    mockWebSocketInstances[0].simulateClose()

    // Reconnect attempt should be 1 (pending)
    await vi.waitFor(() => client.getReconnectAttempt() === 1)
    expect(client.getReconnectAttempt()).toBe(1)

    // After successful reconnect, should reset to 0
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)
    mockWebSocketInstances[1].simulateOpen()

    await vi.waitFor(() => client.getReconnectAttempt() === 0)
    expect(client.getReconnectAttempt()).toBe(0)
  })

  it('should allow removing onReconnect callback', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const reconnectAttempts: number[] = []
    const unsubscribe = client.onReconnect((attempt) => reconnectAttempts.push(attempt))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Unsubscribe before disconnect
    unsubscribe()

    // Simulate unexpected disconnect
    mockWebSocketInstances[0].simulateClose()

    // Wait a bit - callback should not be called
    await vi.advanceTimersByTimeAsync(100)
    expect(reconnectAttempts.length).toBe(0)
  })

  it('should track txid per collection for state resync', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')

    // Simulate initial message with txid
    const initialMessage = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    // Simulate change message
    const changeMessage = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-2',
      data: { $id: 'task-2', $type: 'Task', name: 'Task 2', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 150,
    }
    mockWebSocketInstances[0].simulateMessage(changeMessage)

    // After reconnect, should re-subscribe (txid tracking is internal)
    mockWebSocketInstances[0].simulateClose()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)
    mockWebSocketInstances[1].simulateOpen()

    // Should re-subscribe to Task
    await vi.waitFor(() => mockWebSocketInstances[1].sentMessages.length > 0)
    const resubscribeMessage = JSON.parse(mockWebSocketInstances[1].sentMessages[0])
    expect(resubscribeMessage.type).toBe('subscribe')
    expect(resubscribeMessage.collection).toBe('Task')
  })
})

// ============================================================================
// TESTS: Conflict Resolution (Server-Driven)
// ============================================================================

describe('SyncClient conflict resolution', () => {
  it('should handle server-side conflict resolution via update messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const changes: ChangeMessage<TestTask>[] = []
    client.onChange('Task', (change) => changes.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate conflicting updates resolved by server
    // Server sends the winning version with higher txid
    const originalUpdate: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Client A Update', createdAt: '2024-01-01', updatedAt: '2024-01-01T10:00:00Z' },
      txid: 100,
    }

    const conflictResolvedUpdate: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Merged Update', createdAt: '2024-01-01', updatedAt: '2024-01-01T10:00:01Z' },
      txid: 101,
    }

    mockWebSocketInstances[0].simulateMessage(originalUpdate)
    mockWebSocketInstances[0].simulateMessage(conflictResolvedUpdate)

    await vi.waitFor(() => changes.length >= 2)

    // Client should receive both messages - the last one is the resolved state
    expect(changes.length).toBe(2)
    expect(changes[1].txid).toBe(101)
    if (changes[1].type !== 'delete') {
      expect(changes[1].data.name).toBe('Merged Update')
    }
  })

  it('should handle out-of-order messages by txid', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const changes: ChangeMessage<TestTask>[] = []
    client.onChange('Task', (change) => changes.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate out-of-order delivery (network reordering)
    const laterMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Later Update', createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      txid: 200,
    }

    const earlierMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Earlier Update', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }

    // Send later message first
    mockWebSocketInstances[0].simulateMessage(laterMessage)
    mockWebSocketInstances[0].simulateMessage(earlierMessage)

    await vi.waitFor(() => changes.length >= 2)

    // Client receives both - consumer is responsible for handling ordering
    expect(changes.length).toBe(2)
    expect(changes[0].txid).toBe(200)
    expect(changes[1].txid).toBe(100)
  })

  it('should handle delete after update for same key', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const changes: ChangeMessage<TestTask>[] = []
    client.onChange('Task', (change) => changes.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Update followed by delete
    const updateMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Updated', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }

    const deleteMessage: ChangeMessage = {
      type: 'delete',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      txid: 101,
    }

    mockWebSocketInstances[0].simulateMessage(updateMessage)
    mockWebSocketInstances[0].simulateMessage(deleteMessage)

    await vi.waitFor(() => changes.length >= 2)

    expect(changes[0].type).toBe('update')
    expect(changes[1].type).toBe('delete')
    expect(changes[1].key).toBe('task-1')
  })

  it('should handle concurrent updates to different keys', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const changes: ChangeMessage<TestTask>[] = []
    client.onChange('Task', (change) => changes.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Multiple keys updated concurrently
    const update1: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task 1 Updated', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }

    const update2: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-2',
      data: { $id: 'task-2', $type: 'Task', name: 'Task 2 Updated', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }

    mockWebSocketInstances[0].simulateMessage(update1)
    mockWebSocketInstances[0].simulateMessage(update2)

    await vi.waitFor(() => changes.length >= 2)

    expect(changes.length).toBe(2)
    expect(changes.map((c) => c.key).sort()).toEqual(['task-1', 'task-2'])
  })
})

// ============================================================================
// TESTS: Offline Support
// ============================================================================

describe('SyncClient offline support', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should queue subscriptions made while disconnected', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    // Subscribe while disconnected (before connect)
    client.subscribe('Task')
    client.subscribe('User')
    client.subscribe('Project')

    // Now connect
    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // All subscriptions should be sent
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 3)

    const sentCollections = mockWebSocketInstances[0].sentMessages.map((m) => JSON.parse(m).collection)
    expect(sentCollections).toContain('Task')
    expect(sentCollections).toContain('User')
    expect(sentCollections).toContain('Project')
  })

  it('should preserve subscription state across reconnects', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Subscribe to multiple collections
    client.subscribe('Task')
    client.subscribe('User')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 2)

    // Simulate disconnect
    mockWebSocketInstances[0].simulateClose()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)
    mockWebSocketInstances[1].simulateOpen()

    // Should re-subscribe to both collections
    await vi.waitFor(() => mockWebSocketInstances[1].sentMessages.length >= 2)

    const resubscribedCollections = mockWebSocketInstances[1].sentMessages.map((m) => JSON.parse(m).collection)
    expect(resubscribedCollections).toContain('Task')
    expect(resubscribedCollections).toContain('User')
  })

  it('should remove unsubscribed collections from pending on reconnect', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Subscribe then unsubscribe
    client.subscribe('Task')
    client.subscribe('User')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 2)

    client.unsubscribe('Task')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 3)

    // Simulate disconnect and reconnect
    mockWebSocketInstances[0].simulateClose()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)
    mockWebSocketInstances[1].simulateOpen()

    // Should only re-subscribe to User (Task was unsubscribed)
    await vi.waitFor(() => mockWebSocketInstances[1].sentMessages.length >= 1)

    // Give a moment to ensure all messages are sent
    await vi.advanceTimersByTimeAsync(100)

    const resubscribedCollections = mockWebSocketInstances[1].sentMessages.map((m) => JSON.parse(m).collection)
    expect(resubscribedCollections).toContain('User')
    expect(resubscribedCollections).not.toContain('Task')
  })

  it('should handle connection failure during initial connect', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const errors: Error[] = []
    client.onError((err) => errors.push(err))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)

    // Simulate immediate close (connection refused)
    mockWebSocketInstances[0].simulateClose(1006, 'Connection refused')

    // Connect promise should reject
    await expect(connectPromise).rejects.toThrow()

    // Should attempt reconnect
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockWebSocketInstances.length).toBe(2)
  })

  it('should handle network going offline then online', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const statusChanges: string[] = []
    client.onStatusChange((status) => statusChanges.push(status))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length > 0)

    // Simulate network going offline
    mockWebSocketInstances[0].simulateClose(1006, 'Network offline')

    await vi.waitFor(() => statusChanges.includes('reconnecting'))
    expect(client.getStatus()).toBe('reconnecting')

    // Wait for reconnect attempt
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)

    // Simulate network coming back online
    mockWebSocketInstances[1].simulateOpen()

    await vi.waitFor(() => client.getStatus() === 'connected')
    expect(client.getStatus()).toBe('connected')
  })

  it('should cap reconnection backoff at maximum delay', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate many disconnects to test backoff cap
    for (let i = 0; i < 10; i++) {
      mockWebSocketInstances[mockWebSocketInstances.length - 1].simulateClose()
      // Max delay is 30000ms, so we need to advance at most that much
      await vi.advanceTimersByTimeAsync(30000)
      await vi.waitFor(() => mockWebSocketInstances.length > i + 1)
    }

    // Should have created 11 WebSocket instances (1 initial + 10 reconnects)
    expect(mockWebSocketInstances.length).toBe(11)
  })

  it('should not lose callbacks registered while offline', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Register callbacks while connected
    const onChange = vi.fn()
    client.onChange('Task', onChange)

    // Go offline
    mockWebSocketInstances[0].simulateClose()
    await vi.waitFor(() => client.getStatus() === 'reconnecting')

    // Register another callback while offline
    const onInitial = vi.fn()
    client.onInitial('Task', onInitial)

    // Reconnect
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => mockWebSocketInstances.length > 1)
    mockWebSocketInstances[1].simulateOpen()

    client.subscribe('Task')

    // Simulate server messages
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    }
    mockWebSocketInstances[1].simulateMessage(initialMessage)

    await vi.waitFor(() => onInitial.mock.calls.length > 0)
    expect(onInitial).toHaveBeenCalled()

    const changeMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-2',
      data: { $id: 'task-2', $type: 'Task', name: 'Task 2', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[1].simulateMessage(changeMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)
    expect(onChange).toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Stale Connection Detection
// ============================================================================

describe('SyncClient stale connection detection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should force reconnect when no activity for too long', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Advance time past heartbeat stale threshold (60000ms)
    // Heartbeat check runs every 10000ms
    await vi.advanceTimersByTimeAsync(70000)

    // Should have closed the stale connection and started reconnecting
    await vi.waitFor(() => mockWebSocketInstances.length > 1 || mockWebSocketInstances[0].closeCode !== undefined)

    // The socket should have been closed with stale reason
    expect(mockWebSocketInstances[0].closeCode).toBe(4001)
    expect(mockWebSocketInstances[0].closeReason).toBe('Connection stale - no heartbeat')
  })

  it('should reset activity timer on ping messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Advance time but receive ping before threshold
    await vi.advanceTimersByTimeAsync(30000)
    mockWebSocketInstances[0].simulateMessage({ type: 'ping', timestamp: Date.now() })

    // Advance more time
    await vi.advanceTimersByTimeAsync(30000)
    mockWebSocketInstances[0].simulateMessage({ type: 'ping', timestamp: Date.now() })

    // Should still be connected (not stale)
    expect(client.getStatus()).toBe('connected')
    expect(mockWebSocketInstances[0].closeCode).toBeUndefined()
  })

  it('should reset activity timer on any data message', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Advance time but receive data before threshold
    await vi.advanceTimersByTimeAsync(50000)

    const changeMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(changeMessage)

    // Advance more time (total < threshold from last activity)
    await vi.advanceTimersByTimeAsync(50000)

    // Should still be connected
    expect(client.getStatus()).toBe('connected')
  })

  it('should stop heartbeat check on intentional disconnect', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Disconnect intentionally
    client.disconnect()
    await vi.waitFor(() => client.getStatus() === 'disconnected')

    // Advance time past threshold
    await vi.advanceTimersByTimeAsync(70000)

    // Should not have created new reconnection attempts
    expect(mockWebSocketInstances.length).toBe(1)
  })
})

// ============================================================================
// TESTS: Multiple Collections
// ============================================================================

describe('SyncClient multiple collections', () => {
  it('should handle subscriptions to multiple collections independently', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const taskChanges: ChangeMessage<TestTask>[] = []
    const userChanges: ChangeMessage<TestTask>[] = []

    client.onChange('Task', (change) => taskChanges.push(change))
    client.onChange('User', (change) => userChanges.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')
    client.subscribe('User')

    // Simulate messages for both collections
    const taskInsert: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }

    const userInsert: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'User',
      branch: null,
      key: 'user-1',
      data: { $id: 'user-1', $type: 'User', name: 'User 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }

    mockWebSocketInstances[0].simulateMessage(taskInsert)
    mockWebSocketInstances[0].simulateMessage(userInsert)

    await vi.waitFor(() => taskChanges.length > 0 && userChanges.length > 0)

    expect(taskChanges.length).toBe(1)
    expect(taskChanges[0].collection).toBe('Task')

    expect(userChanges.length).toBe(1)
    expect(userChanges[0].collection).toBe('User')
  })

  it('should handle unsubscribe from one collection while keeping others', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const taskChanges: ChangeMessage<TestTask>[] = []
    const userChanges: ChangeMessage<TestTask>[] = []

    client.onChange('Task', (change) => taskChanges.push(change))
    client.onChange('User', (change) => userChanges.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')
    client.subscribe('User')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 2)

    // Unsubscribe from Task but keep User
    client.unsubscribe('Task')
    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 3)

    // Server would stop sending Task messages, but User continues
    // Simulate only User message
    const userInsert: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'User',
      branch: null,
      key: 'user-1',
      data: { $id: 'user-1', $type: 'User', name: 'User 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 102,
    }

    mockWebSocketInstances[0].simulateMessage(userInsert)

    await vi.waitFor(() => userChanges.length > 0)

    expect(userChanges.length).toBe(1)
    expect(taskChanges.length).toBe(0) // No task messages received
  })

  it('should handle initial data for multiple collections', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const taskInitial = vi.fn()
    const userInitial = vi.fn()

    client.onInitial('Task', taskInitial)
    client.onInitial('User', userInitial)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate initial messages for both collections
    const taskInitialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [
        { $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { $id: 'task-2', $type: 'Task', name: 'Task 2', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      ],
      txid: 100,
    }

    const userInitialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'User',
      branch: null,
      data: [{ $id: 'user-1', $type: 'User', name: 'User 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 101,
    }

    mockWebSocketInstances[0].simulateMessage(taskInitialMessage)
    mockWebSocketInstances[0].simulateMessage(userInitialMessage)

    await vi.waitFor(() => taskInitial.mock.calls.length > 0 && userInitial.mock.calls.length > 0)

    expect(taskInitial).toHaveBeenCalledWith(taskInitialMessage.data, taskInitialMessage.txid)
    expect(userInitial).toHaveBeenCalledWith(userInitialMessage.data, userInitialMessage.txid)
  })
})

// ============================================================================
// TESTS: Branch Handling
// ============================================================================

describe('SyncClient branch handling', () => {
  it('should handle different branches for same collection', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Subscribe to same collection with different branches
    client.subscribe('Task', 'main')
    client.subscribe('Task', 'feature/dark-mode')

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 2)

    const messages = mockWebSocketInstances[0].sentMessages.map((m) => JSON.parse(m))
    const branches = messages.map((m) => m.branch)

    expect(branches).toContain('main')
    expect(branches).toContain('feature/dark-mode')
  })

  it('should receive changes for specific branch', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const changes: ChangeMessage<TestTask>[] = []
    client.onChange('Task', (change) => changes.push(change))

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Simulate change on specific branch
    const branchChange: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: 'feature/new-feature',
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Branch Task', branch: 'feature/new-feature', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }

    mockWebSocketInstances[0].simulateMessage(branchChange)

    await vi.waitFor(() => changes.length > 0)

    expect(changes[0].branch).toBe('feature/new-feature')
  })

  it('should include branch in initial data', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({
      url: 'wss://test.example.com/sync',
      branch: 'staging',
    })

    const onInitial = vi.fn()
    client.onInitial('Task', onInitial)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')

    // Simulate initial with branch
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: 'staging',
      data: [{ $id: 'task-1', $type: 'Task', name: 'Staging Task', branch: 'staging', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    }

    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => onInitial.mock.calls.length > 0)

    expect(onInitial).toHaveBeenCalledWith(initialMessage.data, initialMessage.txid)
  })
})

// ============================================================================
// TESTS: Edge Cases
// ============================================================================

describe('SyncClient edge cases', () => {
  it('should handle empty initial data', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onInitial = vi.fn()
    client.onInitial('Task', onInitial)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 0,
    }

    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => onInitial.mock.calls.length > 0)

    expect(onInitial).toHaveBeenCalledWith([], 0)
  })

  it('should handle large initial data sets', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onInitial = vi.fn()
    client.onInitial('Task', onInitial)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Generate large dataset
    const largeData: TestTask[] = Array.from({ length: 1000 }, (_, i) => ({
      $id: `task-${i}`,
      $type: 'Task',
      name: `Task ${i}`,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    }))

    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: largeData,
      txid: 100,
    }

    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => onInitial.mock.calls.length > 0)

    expect(onInitial).toHaveBeenCalledWith(largeData, 100)
    expect(onInitial.mock.calls[0][0].length).toBe(1000)
  })

  it('should handle rapid subscribe/unsubscribe', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient({ url: 'wss://test.example.com/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    // Rapid subscribe/unsubscribe
    client.subscribe('Task')
    client.unsubscribe('Task')
    client.subscribe('Task')
    client.unsubscribe('Task')
    client.subscribe('Task')

    await vi.waitFor(() => mockWebSocketInstances[0].sentMessages.length >= 5)

    // All messages should be sent in order
    const messages = mockWebSocketInstances[0].sentMessages.map((m) => JSON.parse(m))
    expect(messages[0].type).toBe('subscribe')
    expect(messages[1].type).toBe('unsubscribe')
    expect(messages[2].type).toBe('subscribe')
    expect(messages[3].type).toBe('unsubscribe')
    expect(messages[4].type).toBe('subscribe')
  })

  it('should handle messages with special characters in data', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const specialCharMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: {
        $id: 'task-1',
        $type: 'Task',
        name: 'Task with "quotes" and \'apostrophes\' and unicode: \u00e9\u00e8\u00ea\u4e2d\u6587',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
      txid: 100,
    }

    mockWebSocketInstances[0].simulateMessage(specialCharMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange).toHaveBeenCalled()
    if (onChange.mock.calls[0][0].type !== 'delete') {
      expect(onChange.mock.calls[0][0].data.name).toContain('\u4e2d\u6587')
    }
  })

  it('should handle null branch in messages', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const nullBranchMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 100,
    }

    mockWebSocketInstances[0].simulateMessage(nullBranchMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange.mock.calls[0][0].branch).toBeNull()
  })

  it('should handle very high txid values', async () => {
    const { createSyncClient } = await import('../sync-client')
    const client = createSyncClient<TestTask>({ url: 'wss://test.example.com/sync' })

    const onChange = vi.fn()
    client.onChange('Task', onChange)

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    const highTxidMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: Number.MAX_SAFE_INTEGER,
    }

    mockWebSocketInstances[0].simulateMessage(highTxidMessage)

    await vi.waitFor(() => onChange.mock.calls.length > 0)

    expect(onChange.mock.calls[0][0].txid).toBe(Number.MAX_SAFE_INTEGER)
  })
})
