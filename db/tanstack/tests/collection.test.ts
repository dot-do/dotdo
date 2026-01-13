/**
 * Collection Options Factory Tests
 *
 * Tests for dotdoCollectionOptions(), createCollectionOptions(), and CollectionOptions()
 * which provide TanStack DB compatible collection configurations.
 *
 * These factories:
 * 1. Wire SyncClient (WebSocket) for real-time sync
 * 2. Wire RPC client for mutations
 * 3. Return TanStack DB compatible collection options
 *
 * @module db/tanstack/tests/collection.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChangeMessage, InitialMessage } from '../protocol'

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
    // Simulate async connection
    setTimeout(() => this.simulateOpen(), 0)
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

// Mock fetch for RPC
const mockFetch = vi.fn()

// Store original globals
let originalWebSocket: typeof WebSocket
let originalFetch: typeof fetch
let mockWebSocketInstances: MockWebSocket[] = []

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  originalFetch = globalThis.fetch
  mockWebSocketInstances = []

  // @ts-expect-error - Replacing WebSocket with mock
  globalThis.WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url)
      mockWebSocketInstances.push(this)
    }
  }

  globalThis.fetch = mockFetch
  mockFetch.mockReset()
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  mockWebSocketInstances = []
  vi.clearAllTimers()
})

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestTask {
  $id: string
  $type: string
  name: string
  status?: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ============================================================================
// TESTS: dotdoCollectionOptions
// ============================================================================

describe('dotdoCollectionOptions()', () => {
  it('should create collection options with correct id', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    expect(options.id).toBe('dotdo:Task')
  })

  it('should include branch in id when provided', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
      branch: 'feature/dark-mode',
    })

    expect(options.id).toBe('dotdo:Task:feature/dark-mode')
  })

  it('should use $id as key getter', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const key = options.getKey({
      $id: 'task-123',
      $type: 'Task',
      name: 'Test',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    })
    expect(key).toBe('task-123')
  })

  it('should throw on empty collection name', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    expect(() => dotdoCollectionOptions({
      name: '',
      doUrl: 'https://my-app.workers.dev/api',
    })).toThrow('Collection name cannot be empty')
  })

  it('should throw on invalid URL', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    expect(() => dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'not-a-valid-url',
    })).toThrow('Invalid URL')
  })

  it('should convert http URL to ws for WebSocket', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)

    expect(mockWebSocketInstances[0].url).toBe('wss://my-app.workers.dev/api/sync')
  })

  it('should provide sync function that handles initial state', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    // Simulate initial data from server
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

    await vi.waitFor(() => mockSyncContext.markReady.mock.calls.length > 0)

    expect(mockSyncContext.begin).toHaveBeenCalled()
    expect(mockSyncContext.write).toHaveBeenCalledTimes(2)
    expect(mockSyncContext.write).toHaveBeenNthCalledWith(1, {
      type: 'insert',
      value: initialMessage.data[0],
    })
    expect(mockSyncContext.write).toHaveBeenNthCalledWith(2, {
      type: 'insert',
      value: initialMessage.data[1],
    })
    expect(mockSyncContext.commit).toHaveBeenCalled()
    expect(mockSyncContext.markReady).toHaveBeenCalled()
  })

  it('should handle change messages (insert)', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-new',
      data: { $id: 'task-new', $type: 'Task', name: 'New Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await vi.waitFor(() => mockSyncContext.write.mock.calls.length > 0)

    expect(mockSyncContext.begin).toHaveBeenCalled()
    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'insert',
      value: insertMessage.data,
    })
    expect(mockSyncContext.commit).toHaveBeenCalled()
  })

  it('should handle change messages (update)', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const updateMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Updated Task', createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      txid: 102,
    }
    mockWebSocketInstances[0].simulateMessage(updateMessage)

    await vi.waitFor(() => mockSyncContext.write.mock.calls.length > 0)

    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'update',
      value: updateMessage.data,
    })
  })

  it('should handle change messages (delete)', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
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

    await vi.waitFor(() => mockSyncContext.write.mock.calls.length > 0)

    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'delete',
      key: 'task-1',
    })
  })

  it('should return cleanup function that disconnects', async () => {
    const { dotdoCollectionOptions } = await import('../collection')

    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    const cleanup = options.sync(mockSyncContext)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    expect(typeof cleanup).toBe('function')
    cleanup()

    // WebSocket should be closed
    await vi.waitFor(() => mockWebSocketInstances[0].readyState === MockWebSocket.CLOSED || mockWebSocketInstances[0].readyState === MockWebSocket.CLOSING)
  })
})

// ============================================================================
// TESTS: createCollectionOptions (with mutation handlers)
// ============================================================================

describe('createCollectionOptions()', () => {
  beforeEach(() => {
    // Mock successful RPC responses
    mockFetch.mockImplementation(async (url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      return {
        ok: true,
        json: async () => ({
          id: body.id,
          type: 'result',
          results: body.calls.map((call: { promiseId: string }) => ({
            promiseId: call.promiseId,
            type: 'value',
            value: { success: true, rowid: Math.floor(Math.random() * 1000) + 1 },
          })),
        }),
      }
    })
  })

  it('should extend base options with mutation handlers', async () => {
    const { createCollectionOptions } = await import('../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    expect(options.id).toBe('dotdo:Task')
    expect(options.getKey).toBeDefined()
    expect(options.sync).toBeDefined()
    expect(options.onInsert).toBeDefined()
    expect(options.onUpdate).toBeDefined()
    expect(options.onDelete).toBeDefined()
  })

  it('should call RPC for onInsert', async () => {
    const { createCollectionOptions } = await import('../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const result = await options.onInsert({
      transaction: {
        mutations: [{
          key: 'task-1',
          modified: { $id: 'task-1', $type: 'Task', name: 'New Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        }],
      },
      collection: {},
    })

    expect(mockFetch).toHaveBeenCalled()
    const [url, fetchOptions] = mockFetch.mock.calls[0]
    expect(url).toBe('https://my-app.workers.dev/api/rpc')

    const body = JSON.parse(fetchOptions.body)
    expect(body.calls[0].method).toBe('Task.create')
    expect(result.txid).toBeGreaterThan(0)
  })

  it('should call RPC for onUpdate', async () => {
    const { createCollectionOptions } = await import('../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const result = await options.onUpdate({
      transaction: {
        mutations: [{
          key: 'task-1',
          changes: { name: 'Updated Task' },
        }],
      },
      collection: {},
    })

    expect(mockFetch).toHaveBeenCalled()
    const [, fetchOptions] = mockFetch.mock.calls[0]

    const body = JSON.parse(fetchOptions.body)
    expect(body.calls[0].method).toBe('Task.update')
    expect(result.txid).toBeGreaterThan(0)
  })

  it('should call RPC for onDelete', async () => {
    const { createCollectionOptions } = await import('../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const result = await options.onDelete({
      transaction: {
        mutations: [{
          key: 'task-1',
        }],
      },
      collection: {},
    })

    expect(mockFetch).toHaveBeenCalled()
    const [, fetchOptions] = mockFetch.mock.calls[0]

    const body = JSON.parse(fetchOptions.body)
    expect(body.calls[0].method).toBe('Task.delete')
    expect(result.txid).toBeGreaterThan(0)
  })

  it('should batch multiple mutations in single RPC call', async () => {
    const { createCollectionOptions } = await import('../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    await options.onInsert({
      transaction: {
        mutations: [
          { key: 'task-1', modified: { $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' } },
          { key: 'task-2', modified: { $id: 'task-2', $type: 'Task', name: 'Task 2', createdAt: '2024-01-01', updatedAt: '2024-01-01' } },
          { key: 'task-3', modified: { $id: 'task-3', $type: 'Task', name: 'Task 3', createdAt: '2024-01-01', updatedAt: '2024-01-01' } },
        ],
      },
      collection: {},
    })

    // Should be a single fetch call with batch type
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, fetchOptions] = mockFetch.mock.calls[0]

    const body = JSON.parse(fetchOptions.body)
    expect(body.type).toBe('batch')
    expect(body.calls.length).toBe(3)
  })
})

// ============================================================================
// TESTS: CollectionOptions (callback-style API)
// ============================================================================

describe('CollectionOptions()', () => {
  beforeEach(() => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        type: 'result',
        results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
      }),
    }))
  })

  it('should create collection options with subscribe method', async () => {
    const { CollectionOptions } = await import('../collection')

    const options = CollectionOptions<TestTask>({
      doUrl: 'https://my-app.workers.dev/api',
      collection: 'Task',
    })

    expect(options.id).toBe('dotdo:Task')
    expect(options.subscribe).toBeDefined()
    expect(typeof options.subscribe).toBe('function')
  })

  it('should call callbacks on subscribe', async () => {
    const { CollectionOptions } = await import('../collection')

    const options = CollectionOptions<TestTask>({
      doUrl: 'wss://my-app.workers.dev/api',
      collection: 'Task',
    })

    const callbacks = {
      begin: vi.fn(),
      onData: vi.fn(),
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      commit: vi.fn(),
    }

    const unsubscribe = options.subscribe(callbacks)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    // Simulate initial data
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    }
    mockWebSocketInstances[0].simulateMessage(initialMessage)

    await vi.waitFor(() => callbacks.onData.mock.calls.length > 0)

    expect(callbacks.begin).toHaveBeenCalled()
    expect(callbacks.onData).toHaveBeenCalledWith(initialMessage.data)
    expect(callbacks.commit).toHaveBeenCalledWith({ txid: 100 })

    unsubscribe()
  })

  it('should call onInsert callback for insert changes', async () => {
    const { CollectionOptions } = await import('../collection')

    const options = CollectionOptions<TestTask>({
      doUrl: 'wss://my-app.workers.dev/api',
      collection: 'Task',
    })

    const callbacks = {
      begin: vi.fn(),
      onData: vi.fn(),
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      commit: vi.fn(),
    }

    options.subscribe(callbacks)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-new',
      data: { $id: 'task-new', $type: 'Task', name: 'New Task', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    mockWebSocketInstances[0].simulateMessage(insertMessage)

    await vi.waitFor(() => callbacks.onInsert.mock.calls.length > 0)

    expect(callbacks.onInsert).toHaveBeenCalledWith(insertMessage.data)
    expect(callbacks.commit).toHaveBeenCalledWith({ txid: 101 })
  })

  it('should call onUpdate callback for update changes', async () => {
    const { CollectionOptions } = await import('../collection')

    const options = CollectionOptions<TestTask>({
      doUrl: 'wss://my-app.workers.dev/api',
      collection: 'Task',
    })

    const callbacks = {
      begin: vi.fn(),
      onData: vi.fn(),
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      commit: vi.fn(),
    }

    options.subscribe(callbacks)
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()

    const updateMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Updated', createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      txid: 102,
    }
    mockWebSocketInstances[0].simulateMessage(updateMessage)

    await vi.waitFor(() => callbacks.onUpdate.mock.calls.length > 0)

    expect(callbacks.onUpdate).toHaveBeenCalledWith(updateMessage.data)
  })

  it('should call onDelete callback for delete changes', async () => {
    const { CollectionOptions } = await import('../collection')

    const options = CollectionOptions<TestTask>({
      doUrl: 'wss://my-app.workers.dev/api',
      collection: 'Task',
    })

    const callbacks = {
      begin: vi.fn(),
      onData: vi.fn(),
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      commit: vi.fn(),
    }

    options.subscribe(callbacks)
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

    await vi.waitFor(() => callbacks.onDelete.mock.calls.length > 0)

    expect(callbacks.onDelete).toHaveBeenCalledWith({ id: 'task-1' })
  })

  it('should include branch in id when provided', async () => {
    const { CollectionOptions } = await import('../collection')

    const options = CollectionOptions<TestTask>({
      doUrl: 'https://my-app.workers.dev/api',
      collection: 'Task',
      branch: 'feature/new-ui',
    })

    expect(options.id).toBe('dotdo:Task:feature/new-ui')
  })
})

// ============================================================================
// TESTS: RPC URL derivation
// ============================================================================

describe('deriveRpcUrl()', () => {
  it('should convert wss:// to https://', async () => {
    const { deriveRpcUrl } = await import('../rpc')
    expect(deriveRpcUrl('wss://example.com/api')).toBe('https://example.com/api/rpc')
  })

  it('should convert ws:// to http://', async () => {
    const { deriveRpcUrl } = await import('../rpc')
    expect(deriveRpcUrl('ws://localhost:8787/api')).toBe('http://localhost:8787/api/rpc')
  })

  it('should remove /sync suffix before adding /rpc', async () => {
    const { deriveRpcUrl } = await import('../rpc')
    expect(deriveRpcUrl('wss://example.com/api/sync')).toBe('https://example.com/api/rpc')
  })

  it('should preserve existing https:// URLs', async () => {
    const { deriveRpcUrl } = await import('../rpc')
    expect(deriveRpcUrl('https://example.com/api')).toBe('https://example.com/api/rpc')
  })
})
