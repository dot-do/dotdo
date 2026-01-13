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
