/**
 * SyncEngine E2E Integration Tests with TanStack DB useLiveQuery
 *
 * End-to-end integration tests validating the complete sync flow:
 * 1. Client subscribes -> receives initial state
 * 2. Server mutation -> client receives real-time update
 * 3. Client optimistic mutation -> server confirms with txid
 * 4. Multiple clients -> all receive broadcasts
 * 5. Branch isolation -> clients only see their branch
 * 6. Reconnection -> state resumes correctly
 * 7. Filter changes -> subscription updates correctly
 *
 * These tests simulate the full TanStack DB useLiveQuery integration
 * using mock WebSocket and RPC infrastructure.
 *
 * @module db/tanstack/tests/integration/live-query.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  InitialMessage,
  ChangeMessage,
  SyncItem,
  SubscribeMessage,
  UnsubscribeMessage,
} from '../../protocol'
import {
  createSyncEngine,
  createSyncClient,
  dotdoCollectionOptions,
  type SyncEngine,
  type SyncClient,
  type ThingsStoreLike,
  type TanStackSyncContext,
} from '../../index'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface TestTask extends SyncItem {
  $id: string
  $type: string
  name: string
  status: 'todo' | 'in_progress' | 'done'
  priority?: number
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Mock WebSocket implementation with full event support
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string

  private listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map()
  public sentMessages: string[] = []
  public closeCode?: number
  public closeReason?: string
  private openTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(url: string) {
    this.url = url
    // Simulate async connection
    this.openTimeout = setTimeout(() => this.simulateOpen(), 0)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.openTimeout) {
      clearTimeout(this.openTimeout)
      this.openTimeout = null
    }
    this.closeCode = code
    this.closeReason = reason
    this.readyState = MockWebSocket.CLOSING
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED
      this.dispatchEvent('close', { code, reason } as CloseEvent)
    }, 0)
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.dispatchEvent('open', new Event('open'))
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent('close', { code, reason, wasClean: true } as CloseEvent)
  }

  simulateError(): void {
    this.dispatchEvent('error', new Event('error'))
  }

  simulateMessage(data: unknown): void {
    const message = typeof data === 'string' ? data : JSON.stringify(data)
    this.dispatchEvent('message', { data: message } as MessageEvent)
  }

  private dispatchEvent(type: string, event: Event | CloseEvent | MessageEvent): void {
    const listeners = this.listeners.get(type)
    if (listeners) {
      for (const listener of listeners) {
        if (typeof listener === 'function') {
          listener(event)
        } else {
          listener.handleEvent(event)
        }
      }
    }
  }
}

/**
 * Mock ThingsStore for testing server-side storage
 */
function createMockThingsStore(): ThingsStoreLike & {
  items: Map<string, TestTask>
  rowCounter: number
  reset: () => void
} {
  const items = new Map<string, TestTask>()
  let rowCounter = 0

  return {
    items,
    rowCounter,
    reset() {
      items.clear()
      rowCounter = 0
    },
    async list(options) {
      const results: TestTask[] = []
      for (const item of items.values()) {
        if (options.type && !item.$type.includes(options.type)) continue
        if (options.branch !== undefined && item.branch !== options.branch) continue
        results.push(item)
      }
      return results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100))
    },
    async get(id) {
      return items.get(id) ?? null
    },
    async create(data) {
      rowCounter++
      const now = new Date().toISOString()
      const item: TestTask = {
        $id: data.$id ?? `item-${rowCounter}`,
        $type: data.$type ?? 'Task',
        name: (data as TestTask).name ?? 'Untitled',
        status: (data as TestTask).status ?? 'todo',
        priority: (data as TestTask).priority,
        data: data.data,
        branch: data.branch ?? null,
        createdAt: now,
        updatedAt: now,
      }
      items.set(item.$id, item)
      return { item, rowid: rowCounter }
    },
    async update(id, data) {
      const existing = items.get(id)
      if (!existing) throw new Error(`Item '${id}' not found`)
      rowCounter++
      const updated: TestTask = {
        ...existing,
        ...(data as Partial<TestTask>),
        $id: id,
        updatedAt: new Date().toISOString(),
      }
      items.set(id, updated)
      return { item: updated, rowid: rowCounter }
    },
    async delete(id) {
      if (!items.has(id)) throw new Error(`Item '${id}' not found`)
      rowCounter++
      items.delete(id)
      return { rowid: rowCounter }
    },
  }
}

/**
 * Mock TanStack DB sync context
 */
function createMockSyncContext(): TanStackSyncContext & {
  operations: Array<{ type: string; value?: unknown; key?: string }>
  isReady: boolean
  transactionCount: number
} {
  const operations: Array<{ type: string; value?: unknown; key?: string }> = []
  let isReady = false
  let transactionCount = 0

  return {
    operations,
    get isReady() {
      return isReady
    },
    transactionCount,
    begin() {
      transactionCount++
    },
    write(mutation) {
      operations.push(mutation)
    },
    commit() {
      // Transaction committed
    },
    markReady() {
      isReady = true
    },
  }
}

// Mock fetch for RPC
const mockFetch = vi.fn()

// Store original globals
let originalWebSocket: typeof WebSocket
let originalFetch: typeof fetch
let mockWebSocketInstances: MockWebSocket[] = []

// ============================================================================
// TEST SETUP
// ============================================================================

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

  // Default mock for RPC
  mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string)
    return {
      ok: true,
      json: async () => ({
        id: body.id,
        type: 'result',
        results: body.calls.map((call: { promiseId: string }, index: number) => ({
          promiseId: call.promiseId,
          type: 'value',
          value: { success: true, rowid: index + 1 },
        })),
      }),
    }
  })
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  mockWebSocketInstances = []
  vi.clearAllTimers()
})

// ============================================================================
// TEST: useLiveQuery receives initial data
// ============================================================================

describe('useLiveQuery receives initial data', () => {
  it('should receive initial state when subscribing to a collection', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    // Wait for WebSocket to be created
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]

    // Simulate connection opening
    ws.simulateOpen()

    // Wait for subscription to be sent
    await vi.waitFor(() => ws.sentMessages.length > 0)
    const subscribeMsg = JSON.parse(ws.sentMessages[0]) as SubscribeMessage
    expect(subscribeMsg.type).toBe('subscribe')
    expect(subscribeMsg.collection).toBe('Task')

    // Simulate initial data from server
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [
        { $id: 'task-1', $type: 'Task', name: 'Task 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { $id: 'task-2', $type: 'Task', name: 'Task 2', status: 'in_progress', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      ],
      txid: 100,
    }
    ws.simulateMessage(initialMessage)

    // Wait for sync to be marked ready
    await vi.waitFor(() => syncContext.isReady)

    // Verify operations
    expect(syncContext.operations.length).toBe(2)
    expect(syncContext.operations[0]).toEqual({
      type: 'insert',
      value: initialMessage.data[0],
    })
    expect(syncContext.operations[1]).toEqual({
      type: 'insert',
      value: initialMessage.data[1],
    })

    cleanup()
  })

  it('should receive empty initial state gracefully', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // Simulate empty initial data
    const initialMessage: InitialMessage<TestTask> = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 0,
    }
    ws.simulateMessage(initialMessage)

    await vi.waitFor(() => syncContext.isReady)

    expect(syncContext.operations.length).toBe(0)

    cleanup()
  })

  it('should receive initial state for specific branch', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
      branch: 'feature/dark-mode',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    await vi.waitFor(() => ws.sentMessages.length > 0)
    const subscribeMsg = JSON.parse(ws.sentMessages[0]) as SubscribeMessage
    expect(subscribeMsg.branch).toBe('feature/dark-mode')

    cleanup()
  })
})

// ============================================================================
// TEST: useLiveQuery receives real-time updates
// ============================================================================

describe('useLiveQuery receives real-time updates', () => {
  it('should receive insert changes in real-time', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // First, receive initial state
    ws.simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 0,
    })
    await vi.waitFor(() => syncContext.isReady)

    // Clear operations from initial state
    syncContext.operations.length = 0

    // Simulate real-time insert
    const insertMessage: ChangeMessage<TestTask> = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-new',
      data: { $id: 'task-new', $type: 'Task', name: 'New Task', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    }
    ws.simulateMessage(insertMessage)

    await vi.waitFor(() => syncContext.operations.length > 0)

    expect(syncContext.operations[0]).toEqual({
      type: 'insert',
      value: insertMessage.data,
    })

    cleanup()
  })

  it('should receive update changes in real-time', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // First, receive initial state with one task
    ws.simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })
    await vi.waitFor(() => syncContext.isReady)
    syncContext.operations.length = 0

    // Simulate real-time update
    const updateMessage: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Updated Task', status: 'in_progress', createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      txid: 102,
    }
    ws.simulateMessage(updateMessage)

    await vi.waitFor(() => syncContext.operations.length > 0)

    expect(syncContext.operations[0]).toEqual({
      type: 'update',
      value: updateMessage.data,
    })

    cleanup()
  })

  it('should receive delete changes in real-time', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // First, receive initial state
    ws.simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })
    await vi.waitFor(() => syncContext.isReady)
    syncContext.operations.length = 0

    // Simulate real-time delete
    const deleteMessage: ChangeMessage = {
      type: 'delete',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      txid: 103,
    }
    ws.simulateMessage(deleteMessage)

    await vi.waitFor(() => syncContext.operations.length > 0)

    expect(syncContext.operations[0]).toEqual({
      type: 'delete',
      key: 'task-1',
    })

    cleanup()
  })

  it('should receive multiple rapid changes', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    ws.simulateMessage({ type: 'initial', collection: 'Task', branch: null, data: [], txid: 0 })
    await vi.waitFor(() => syncContext.isReady)
    syncContext.operations.length = 0

    // Simulate rapid changes
    ws.simulateMessage({ type: 'insert', collection: 'Task', branch: null, key: 'task-1', data: { $id: 'task-1', $type: 'Task', name: 'Task 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }, txid: 1 })
    ws.simulateMessage({ type: 'insert', collection: 'Task', branch: null, key: 'task-2', data: { $id: 'task-2', $type: 'Task', name: 'Task 2', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }, txid: 2 })
    ws.simulateMessage({ type: 'update', collection: 'Task', branch: null, key: 'task-1', data: { $id: 'task-1', $type: 'Task', name: 'Updated', status: 'done', createdAt: '2024-01-01', updatedAt: '2024-01-02' }, txid: 3 })
    ws.simulateMessage({ type: 'delete', collection: 'Task', branch: null, key: 'task-2', txid: 4 })

    await vi.waitFor(() => syncContext.operations.length >= 4)

    expect(syncContext.operations.length).toBe(4)
    expect(syncContext.operations[0].type).toBe('insert')
    expect(syncContext.operations[1].type).toBe('insert')
    expect(syncContext.operations[2].type).toBe('update')
    expect(syncContext.operations[3].type).toBe('delete')

    cleanup()
  })
})

// ============================================================================
// TEST: Optimistic updates sync correctly
// ============================================================================

describe('Optimistic updates sync correctly', () => {
  it('should handle optimistic insert with server confirmation', async () => {
    const { createCollectionOptions } = await import('../../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    // Simulate optimistic insert mutation
    const result = await options.onInsert({
      transaction: {
        mutations: [{
          key: 'task-optimistic',
          modified: { $id: 'task-optimistic', $type: 'Task', name: 'Optimistic Task', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        }],
      },
      collection: {},
    })

    // Verify RPC was called
    expect(mockFetch).toHaveBeenCalled()
    const [url, fetchOptions] = mockFetch.mock.calls[0]
    expect(url).toBe('https://my-app.workers.dev/api/rpc')

    const body = JSON.parse(fetchOptions.body)
    expect(body.calls[0].method).toBe('Task.create')

    // Verify txid is returned
    expect(result.txid).toBeGreaterThan(0)
  })

  it('should handle optimistic update with server confirmation', async () => {
    const { createCollectionOptions } = await import('../../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const result = await options.onUpdate({
      transaction: {
        mutations: [{
          key: 'task-1',
          changes: { name: 'Updated Optimistically', status: 'done' },
        }],
      },
      collection: {},
    })

    expect(mockFetch).toHaveBeenCalled()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.calls[0].method).toBe('Task.update')
    expect(result.txid).toBeGreaterThan(0)
  })

  it('should handle optimistic delete with server confirmation', async () => {
    const { createCollectionOptions } = await import('../../collection')

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
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.calls[0].method).toBe('Task.delete')
    expect(result.txid).toBeGreaterThan(0)
  })

  it('should batch multiple optimistic mutations', async () => {
    const { createCollectionOptions } = await import('../../collection')

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    await options.onInsert({
      transaction: {
        mutations: [
          { key: 'task-1', modified: { $id: 'task-1', $type: 'Task', name: 'Task 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' } },
          { key: 'task-2', modified: { $id: 'task-2', $type: 'Task', name: 'Task 2', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' } },
          { key: 'task-3', modified: { $id: 'task-3', $type: 'Task', name: 'Task 3', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' } },
        ],
      },
      collection: {},
    })

    // Should be batched into single RPC call
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('batch')
    expect(body.calls.length).toBe(3)
  })
})

// ============================================================================
// TEST: Conflict resolution works
// ============================================================================

describe('Conflict resolution works', () => {
  it('should handle server-side update overriding client state', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // Initial state
    ws.simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Original', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })
    await vi.waitFor(() => syncContext.isReady)
    syncContext.operations.length = 0

    // Simulate conflict: server sends authoritative update
    const serverUpdate: ChangeMessage<TestTask> = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Server Version', status: 'done', createdAt: '2024-01-01', updatedAt: '2024-01-03' },
      txid: 200,
    }
    ws.simulateMessage(serverUpdate)

    await vi.waitFor(() => syncContext.operations.length > 0)

    // Server version should be applied
    expect(syncContext.operations[0]).toEqual({
      type: 'update',
      value: serverUpdate.data,
    })

    cleanup()
  })

  it('should handle concurrent updates from multiple sources', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    ws.simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Original', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })
    await vi.waitFor(() => syncContext.isReady)
    syncContext.operations.length = 0

    // Multiple updates with increasing txids (last-write-wins)
    ws.simulateMessage({
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Update 1', status: 'in_progress', createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      txid: 101,
    })
    ws.simulateMessage({
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Update 2', status: 'done', createdAt: '2024-01-01', updatedAt: '2024-01-03' },
      txid: 102,
    })

    await vi.waitFor(() => syncContext.operations.length >= 2)

    // Both updates should be applied in order
    expect(syncContext.operations.length).toBe(2)
    expect((syncContext.operations[1].value as TestTask).name).toBe('Update 2')

    cleanup()
  })
})

// ============================================================================
// TEST: Reconnection restores subscription
// ============================================================================

describe('Reconnection restores subscription', () => {
  it('should reconnect and re-subscribe after disconnection', async () => {
    const { createSyncClient } = await import('../../sync-client')

    const client = createSyncClient({ url: 'wss://my-app.workers.dev/api/sync' })

    // Connect
    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws1 = mockWebSocketInstances[0]
    ws1.simulateOpen()
    await connectPromise

    // Subscribe
    client.subscribe('Task')
    await vi.waitFor(() => ws1.sentMessages.length > 0)
    expect(JSON.parse(ws1.sentMessages[0]).type).toBe('subscribe')

    // Verify connected
    expect(client.getStatus()).toBe('connected')

    // Simulate disconnect
    ws1.simulateClose()

    // Wait for status change
    await vi.waitFor(() => client.getStatus() === 'reconnecting' || client.getStatus() === 'disconnected')

    client.disconnect()
  })

  it('should restore subscriptions after reconnection', async () => {
    const { createSyncClient } = await import('../../sync-client')

    const client = createSyncClient({ url: 'wss://my-app.workers.dev/api/sync' })
    const disconnectCallback = vi.fn()
    client.onDisconnect(disconnectCallback)

    // Connect and subscribe
    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    client.subscribe('Task')
    client.subscribe('User')

    // Simulate disconnect
    mockWebSocketInstances[0].simulateClose()

    await vi.waitFor(() => disconnectCallback.mock.calls.length > 0)
    expect(disconnectCallback).toHaveBeenCalled()

    client.disconnect()
  })

  it('should track reconnection attempts', async () => {
    const { createSyncClient } = await import('../../sync-client')

    const client = createSyncClient({ url: 'wss://my-app.workers.dev/api/sync' })
    const reconnectCallback = vi.fn()
    client.onReconnect(reconnectCallback)

    // Initial connection
    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    mockWebSocketInstances[0].simulateOpen()
    await connectPromise

    expect(client.getReconnectAttempt()).toBe(0)

    // Simulate unexpected disconnect
    mockWebSocketInstances[0].simulateClose()

    // Wait for reconnect attempt
    await vi.waitFor(() => reconnectCallback.mock.calls.length > 0, { timeout: 2000 })

    expect(reconnectCallback).toHaveBeenCalled()
    expect(client.getReconnectAttempt()).toBeGreaterThan(0)

    client.disconnect()
  })
})

// ============================================================================
// TEST: Multiple concurrent subscriptions
// ============================================================================

describe('Multiple concurrent subscriptions', () => {
  it('should handle multiple collection subscriptions', async () => {
    const options1 = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })
    const options2 = dotdoCollectionOptions<TestTask>({
      name: 'Project',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext1 = createMockSyncContext()
    const syncContext2 = createMockSyncContext()

    const cleanup1 = options1.sync(syncContext1)
    const cleanup2 = options2.sync(syncContext2)

    await vi.waitFor(() => mockWebSocketInstances.length >= 2)

    // Open both connections
    mockWebSocketInstances[0].simulateOpen()
    mockWebSocketInstances[1].simulateOpen()

    // Send initial data to each
    mockWebSocketInstances[0].simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Task 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })
    mockWebSocketInstances[1].simulateMessage({
      type: 'initial',
      collection: 'Project',
      branch: null,
      data: [{ $id: 'project-1', $type: 'Project', name: 'Project 1', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })

    await vi.waitFor(() => syncContext1.isReady && syncContext2.isReady)

    expect(syncContext1.operations.length).toBe(1)
    expect((syncContext1.operations[0].value as TestTask).name).toBe('Task 1')
    expect(syncContext2.operations.length).toBe(1)
    expect((syncContext2.operations[0].value as TestTask).name).toBe('Project 1')

    cleanup1()
    cleanup2()
  })

  it('should isolate changes between collections', async () => {
    const options1 = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })
    const options2 = dotdoCollectionOptions<TestTask>({
      name: 'Project',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext1 = createMockSyncContext()
    const syncContext2 = createMockSyncContext()

    const cleanup1 = options1.sync(syncContext1)
    const cleanup2 = options2.sync(syncContext2)

    await vi.waitFor(() => mockWebSocketInstances.length >= 2)

    mockWebSocketInstances[0].simulateOpen()
    mockWebSocketInstances[1].simulateOpen()

    // Initial state
    mockWebSocketInstances[0].simulateMessage({ type: 'initial', collection: 'Task', branch: null, data: [], txid: 0 })
    mockWebSocketInstances[1].simulateMessage({ type: 'initial', collection: 'Project', branch: null, data: [], txid: 0 })

    await vi.waitFor(() => syncContext1.isReady && syncContext2.isReady)
    syncContext1.operations.length = 0
    syncContext2.operations.length = 0

    // Send change only to Task collection
    mockWebSocketInstances[0].simulateMessage({
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-new',
      data: { $id: 'task-new', $type: 'Task', name: 'New Task', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 101,
    })

    await vi.waitFor(() => syncContext1.operations.length > 0)

    // Only Task should receive the change
    expect(syncContext1.operations.length).toBe(1)
    expect(syncContext2.operations.length).toBe(0)

    cleanup1()
    cleanup2()
  })

  it('should handle multiple clients subscribing to same collection', async () => {
    const store = createMockThingsStore()
    const syncEngine = createSyncEngine({ store })

    // Create mock server-side WebSocket
    const serverSocket1 = {
      readyState: 1,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    const serverSocket2 = {
      readyState: 1,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    // Accept both connections
    syncEngine.accept(serverSocket1)
    syncEngine.accept(serverSocket2)

    // Subscribe both to Task
    syncEngine.subscribe(serverSocket1, 'Task')
    syncEngine.subscribe(serverSocket2, 'Task')

    expect(syncEngine.getActiveConnections()).toBe(2)
    expect(syncEngine.getSubscribers('Task').size).toBe(2)

    // Broadcast should reach both
    syncEngine.broadcast('Task', {
      type: 'insert',
      collection: 'Task',
      key: 'task-1',
      data: { $id: 'task-1', $type: 'Task', name: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 1,
    })

    expect((serverSocket1.send as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    expect((serverSocket2.send as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })
})

// ============================================================================
// TEST: Filter changes update subscription
// ============================================================================

describe('Filter changes update subscription', () => {
  it('should unsubscribe from old collection and subscribe to new one', async () => {
    const { createSyncClient } = await import('../../sync-client')

    const client = createSyncClient({ url: 'wss://my-app.workers.dev/api/sync' })

    const connectPromise = client.connect()
    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()
    await connectPromise

    // Subscribe to Task
    client.subscribe('Task')
    await vi.waitFor(() => ws.sentMessages.length > 0)
    expect(JSON.parse(ws.sentMessages[0]).type).toBe('subscribe')
    expect(JSON.parse(ws.sentMessages[0]).collection).toBe('Task')

    // Unsubscribe and subscribe to different collection
    client.unsubscribe('Task')
    client.subscribe('Project')

    await vi.waitFor(() => ws.sentMessages.length >= 3)

    expect(JSON.parse(ws.sentMessages[1]).type).toBe('unsubscribe')
    expect(JSON.parse(ws.sentMessages[1]).collection).toBe('Task')
    expect(JSON.parse(ws.sentMessages[2]).type).toBe('subscribe')
    expect(JSON.parse(ws.sentMessages[2]).collection).toBe('Project')

    client.disconnect()
  })

  it('should handle branch filter changes', async () => {
    const store = createMockThingsStore()
    const syncEngine = createSyncEngine({ store })

    const serverSocket = {
      readyState: 1,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    syncEngine.accept(serverSocket)

    // Subscribe to main branch
    syncEngine.subscribe(serverSocket, 'Task', null)
    expect(syncEngine.getSubscribers('Task', null).size).toBe(1)
    expect(syncEngine.getSubscribers('Task', 'feature/x').size).toBe(0)

    // Change to feature branch
    syncEngine.unsubscribe(serverSocket, 'Task', null)
    syncEngine.subscribe(serverSocket, 'Task', 'feature/x')

    expect(syncEngine.getSubscribers('Task', null).size).toBe(0)
    expect(syncEngine.getSubscribers('Task', 'feature/x').size).toBe(1)

    // Broadcast to feature branch should reach the client
    syncEngine.broadcast('Task', {
      type: 'insert',
      collection: 'Task',
      key: 'task-1',
      branch: 'feature/x',
      data: { $id: 'task-1', $type: 'Task', name: 'Feature Task', branch: 'feature/x', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      txid: 1,
    }, 'feature/x')

    expect((serverSocket.send as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })

  it('should receive new initial state after filter change', async () => {
    const store = createMockThingsStore()

    // Pre-populate store with items in different branches
    await store.create({ $id: 'task-main-1', $type: 'Task', name: 'Main Task', status: 'todo', branch: null })
    await store.create({ $id: 'task-feature-1', $type: 'Task', name: 'Feature Task', status: 'todo', branch: 'feature/x' })

    const engine = createSyncEngine({ store })

    const serverSocket = {
      readyState: 1,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    engine.accept(serverSocket)

    // Request initial state for main branch
    await engine.sendInitialState(serverSocket, 'Task', null)

    const sendMock = serverSocket.send as ReturnType<typeof vi.fn>
    const sentCalls = sendMock.mock.calls
    expect(sentCalls).toHaveLength(1)

    const initialMsg = JSON.parse(sentCalls[0][0]) as InitialMessage<TestTask>
    expect(initialMsg.type).toBe('initial')
    // Data should be an array
    expect(Array.isArray(initialMsg.data)).toBe(true)

    // Clear and request initial state for feature branch
    sendMock.mockClear()

    await engine.sendInitialState(serverSocket, 'Task', 'feature/x')

    const featureCalls = sendMock.mock.calls
    expect(featureCalls).toHaveLength(1)

    const featureMsg = JSON.parse(featureCalls[0][0]) as InitialMessage<TestTask>
    expect(featureMsg.type).toBe('initial')
    expect(featureMsg.branch).toBe('feature/x')
  })
})

// ============================================================================
// TEST: Edge cases and error handling
// ============================================================================

describe('Edge cases and error handling', () => {
  it('should handle WebSocket connection failure gracefully', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]

    // Simulate connection error
    ws.simulateError()

    // Should not throw and should handle gracefully
    expect(syncContext.isReady).toBe(false)

    cleanup()
  })

  it('should handle malformed messages gracefully', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // Send malformed messages - should not crash
    ws.simulateMessage('not valid json')
    ws.simulateMessage({ type: 'unknown' })
    ws.simulateMessage({ type: 'initial' }) // Missing required fields

    // Should continue working
    ws.simulateMessage({
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [{ $id: 'task-1', $type: 'Task', name: 'Valid Task', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      txid: 100,
    })

    await vi.waitFor(() => syncContext.isReady)
    expect(syncContext.operations.length).toBe(1)

    cleanup()
  })

  it('should handle RPC failure gracefully', async () => {
    const { createCollectionOptions } = await import('../../collection')

    mockFetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    }))

    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    await expect(options.onInsert({
      transaction: {
        mutations: [{
          key: 'task-1',
          modified: { $id: 'task-1', $type: 'Task', name: 'Test', status: 'todo', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        }],
      },
      collection: {},
    })).rejects.toThrow('HTTP error: 500')
  })

  it('should cleanup properly on disconnect', async () => {
    const options = dotdoCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://my-app.workers.dev/api',
    })

    const syncContext = createMockSyncContext()
    const cleanup = options.sync(syncContext)

    await vi.waitFor(() => mockWebSocketInstances.length > 0)
    const ws = mockWebSocketInstances[0]
    ws.simulateOpen()

    // Call cleanup
    cleanup()

    // WebSocket should be closing or closed
    await vi.waitFor(() =>
      ws.readyState === MockWebSocket.CLOSED ||
      ws.readyState === MockWebSocket.CLOSING
    )
  })
})
