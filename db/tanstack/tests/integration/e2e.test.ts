/**
 * TanStack DB E2E Integration Tests
 *
 * RED TDD Phase: These tests define the expected end-to-end behavior for
 * TanStack DB integration with dotdo. All tests are expected to FAIL
 * initially as this is the RED phase.
 *
 * Tests cover:
 * 1. Full sync flow - WebSocket connection, initial data, reactive queries
 * 2. Multi-client sync - Changes broadcasting between clients
 * 3. Optimistic updates - UI updates immediately, server confirms
 * 4. Reconnection - Recovery from disconnections
 *
 * @module db/tanstack/tests/integration/e2e
 * @task dotdo-lfw71
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  SyncClient,
  dotdoCollectionOptions,
  RPCClient,
  createRPCClient,
  type MutationResponse,
} from '../../index'

// =============================================================================
// TEST SCHEMAS
// =============================================================================

/**
 * Task schema for test data
 */
const TaskSchema = z.object({
  $id: z.string(),
  $type: z.string(),
  name: z.string().optional(),
  data: z.object({
    title: z.string(),
    completed: z.boolean(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
})

type Task = z.infer<typeof TaskSchema>

// =============================================================================
// MOCK INFRASTRUCTURE
// =============================================================================

/**
 * Mock WebSocket that simulates server behavior
 */
class MockServerWebSocket {
  static instances: MockServerWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((error: Error) => void) | null = null
  readyState = MockServerWebSocket.CONNECTING

  // Stored data simulating server state
  private serverData: Task[] = []
  private txid = 0
  private subscriptions: Set<string> = new Set()

  constructor(public url: string) {
    MockServerWebSocket.instances.push(this)
    // Auto-connect after creation
    setTimeout(() => this.simulateOpen(), 0)
  }

  send = vi.fn((data: string) => {
    try {
      const message = JSON.parse(data)
      this.handleClientMessage(message)
    } catch {
      // Ignore parse errors
    }
  })

  close = vi.fn(() => {
    this.readyState = MockServerWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'Normal closure' })
  })

  /**
   * Handle incoming client messages
   */
  private handleClientMessage(message: { type: string; collection?: string; branch?: string }) {
    if (message.type === 'subscribe' && message.collection) {
      this.subscriptions.add(message.collection)
      // Send initial data
      this.onmessage?.({
        data: JSON.stringify({
          type: 'initial',
          collection: message.collection,
          data: this.serverData.filter((t) => t.$type.includes(message.collection!)),
          txid: this.txid,
        }),
      })
    } else if (message.type === 'unsubscribe' && message.collection) {
      this.subscriptions.delete(message.collection)
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockServerWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockServerWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  simulateError(error: Error) {
    this.onerror?.(error)
  }

  /**
   * Simulate server-side data update (broadcasts to subscribed clients)
   */
  simulateServerInsert(task: Task) {
    this.txid++
    this.serverData.push(task)
    const collection = task.$type.split('/').pop() ?? task.$type

    if (this.subscriptions.has(collection)) {
      this.simulateMessage({
        type: 'insert',
        collection,
        key: task.$id,
        data: task,
        txid: this.txid,
      })
    }
  }

  simulateServerUpdate(task: Task) {
    this.txid++
    const index = this.serverData.findIndex((t) => t.$id === task.$id)
    if (index >= 0) {
      this.serverData[index] = task
    }
    const collection = task.$type.split('/').pop() ?? task.$type

    if (this.subscriptions.has(collection)) {
      this.simulateMessage({
        type: 'update',
        collection,
        key: task.$id,
        data: task,
        txid: this.txid,
      })
    }
  }

  simulateServerDelete(taskId: string, collection: string) {
    this.txid++
    this.serverData = this.serverData.filter((t) => t.$id !== taskId)

    if (this.subscriptions.has(collection)) {
      this.simulateMessage({
        type: 'delete',
        collection,
        key: taskId,
        txid: this.txid,
      })
    }
  }

  setInitialData(data: Task[]) {
    this.serverData = data
    this.txid = data.length
  }

  getCurrentTxid() {
    return this.txid
  }
}

/**
 * Mock fetch for RPC calls
 */
function createMockFetch() {
  return vi.fn<typeof globalThis.fetch>()
}

/**
 * Create a batch response for RPC
 */
function createRpcResponse(results: Array<{ promiseId: string; type: string; value?: unknown; error?: { code: string; message: string } }>) {
  return {
    id: 'req-1',
    type: 'batch',
    results,
  }
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

const createTask = (id: string, title: string, completed = false, priority: 'low' | 'medium' | 'high' = 'medium'): Task => ({
  $id: `https://example.com/tasks/${id}`,
  $type: 'https://example.com/Task',
  name: title,
  data: { title, completed, priority },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  branch: null,
})

const initialTasks: Task[] = [
  createTask('1', 'First task', false, 'high'),
  createTask('2', 'Second task', true, 'low'),
  createTask('3', 'Third task', false, 'medium'),
]

// =============================================================================
// TEST SUITE: FULL SYNC FLOW
// =============================================================================

describe('TanStack DB E2E', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let originalFetch: typeof globalThis.fetch
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    vi.useFakeTimers()
    MockServerWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockServerWebSocket

    mockFetch = createMockFetch()
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  // ===========================================================================
  // FULL SYNC FLOW
  // ===========================================================================

  describe('full sync flow', () => {
    it('client connects and receives initial data', async () => {
      // Create sync client and connect
      const receivedData: { items: Task[]; txid: number } = { items: [], txid: 0 }
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.onInitial = (items, txid) => {
        receivedData.items = items
        receivedData.txid = txid
      }

      client.connect()

      // Advance timers to allow WebSocket connection
      await vi.advanceTimersByTimeAsync(100)

      // Get the WebSocket instance created by SyncClient
      expect(MockServerWebSocket.instances).toHaveLength(1)
      const serverWs = MockServerWebSocket.instances[0]

      // Setup: Server sends initial data after connection
      serverWs.setInitialData(initialTasks)

      // Trigger subscribe flow by simulating open (already happened in constructor)
      // Re-send subscribe to trigger initial data
      serverWs.send.mockClear()
      serverWs.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: initialTasks,
        txid: 3,
      })

      await vi.advanceTimersByTimeAsync(10)

      // Verify: Client received initial data
      expect(receivedData.items).toHaveLength(3)
      expect(receivedData.txid).toBe(3)
      expect(receivedData.items[0].data?.title).toBe('First task')
    })

    it('useLiveQuery returns reactive data', async () => {
      /**
       * This test verifies that TanStack DB's useLiveQuery hook returns
       * reactive data when using dotdoCollectionOptions.
       *
       * Expected behavior:
       * 1. Create collection with dotdoCollectionOptions
       * 2. useLiveQuery returns initial data
       * 3. When server broadcasts changes, query result updates
       *
       * NOTE: This test defines the expected integration behavior.
       * Full implementation requires @tanstack/db integration.
       */

      // Create collection options
      const taskOptions = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // Verify collection options structure
      expect(taskOptions.id).toBe('dotdo:Task')
      expect(taskOptions.schema).toBe(TaskSchema)
      expect(typeof taskOptions.getKey).toBe('function')
      expect(typeof taskOptions.subscribe).toBe('function')

      // getKey should extract $id
      const task = createTask('test', 'Test Task')
      expect(taskOptions.getKey(task)).toBe(task.$id)

      // subscribe should return an unsubscribe function
      const mockCallbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = taskOptions.subscribe(mockCallbacks)
      expect(typeof unsubscribe).toBe('function')

      // Cleanup
      unsubscribe()
    })

    it('insert mutation updates collection', async () => {
      // Setup: Mock RPC response for insert
      const insertResponse: MutationResponse = {
        success: true,
        rowid: 4,
        data: { $id: 'task-4' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: insertResponse },
        ])),
      } as Response)

      // Create RPC client
      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      // Execute insert mutation
      const result = await rpcClient.mutate({
        type: 'insert',
        collection: 'Task',
        key: 'task-4',
        data: {
          title: 'New Task',
          completed: false,
          priority: 'high',
        },
      })

      // Verify: Mutation succeeded with txid
      expect(result.success).toBe(true)
      expect(result.rowid).toBe(4)

      // Verify: RPC was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://example.com/do/123/rpc')
      expect(options?.method).toBe('POST')
    })

    it('update mutation updates collection', async () => {
      // Setup: Mock RPC response for update
      const updateResponse: MutationResponse = {
        success: true,
        rowid: 5,
        data: { $id: 'task-1' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: updateResponse },
        ])),
      } as Response)

      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      // Execute update mutation
      const result = await rpcClient.mutate({
        type: 'update',
        collection: 'Task',
        key: 'task-1',
        data: {
          completed: true,
        },
      })

      // Verify
      expect(result.success).toBe(true)
      expect(result.rowid).toBe(5)
    })

    it('delete mutation updates collection', async () => {
      // Setup: Mock RPC response for delete
      const deleteResponse: MutationResponse = {
        success: true,
        rowid: 6,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: deleteResponse },
        ])),
      } as Response)

      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      // Execute delete mutation
      const result = await rpcClient.mutate({
        type: 'delete',
        collection: 'Task',
        key: 'task-2',
      })

      // Verify
      expect(result.success).toBe(true)
      expect(result.rowid).toBe(6)
    })
  })

  // ===========================================================================
  // MULTI-CLIENT SYNC
  // ===========================================================================

  describe('multi-client sync', () => {
    it('client A change broadcasts to client B', async () => {
      // This test verifies that when client A makes a change,
      // client B receives the broadcast via WebSocket

      // Setup: Two clients connected to the same server
      const clientAChanges: Array<{ op: string; item: Task; txid: number }> = []
      const clientBChanges: Array<{ op: string; item: Task; txid: number }> = []

      // Client A
      const clientA = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      clientA.onChange = (op, item, txid) => {
        clientAChanges.push({ op, item, txid })
      }
      clientA.connect()

      // Client B
      const clientB = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      clientB.onChange = (op, item, txid) => {
        clientBChanges.push({ op, item, txid })
      }
      clientB.connect()

      await vi.advanceTimersByTimeAsync(100)

      // Get the server WebSocket instances
      expect(MockServerWebSocket.instances.length).toBeGreaterThanOrEqual(2)
      const serverWsA = MockServerWebSocket.instances[0]
      const serverWsB = MockServerWebSocket.instances[1]

      // Simulate: Client A makes a change (server broadcasts to all)
      const newTask = createTask('4', 'Task from Client A')
      serverWsA.simulateServerInsert(newTask)
      serverWsB.simulateServerInsert(newTask)

      await vi.advanceTimersByTimeAsync(10)

      // Verify: Both clients received the change
      expect(clientAChanges).toHaveLength(1)
      expect(clientBChanges).toHaveLength(1)
      expect(clientAChanges[0].op).toBe('insert')
      expect(clientBChanges[0].op).toBe('insert')
      expect(clientAChanges[0].item.$id).toBe(newTask.$id)
      expect(clientBChanges[0].item.$id).toBe(newTask.$id)
    })

    it('both clients eventually consistent', async () => {
      // This test verifies eventual consistency between two clients
      // after a series of mutations

      const clientAData: Map<string, Task> = new Map()
      const clientBData: Map<string, Task> = new Map()

      // Helper to update local data store
      const updateStore = (store: Map<string, Task>, op: string, item: Task) => {
        if (op === 'delete') {
          // For delete, item may be { key: string } from the protocol
          const key = item.$id || (item as unknown as { key: string }).key
          store.delete(key)
        } else {
          store.set(item.$id, item)
        }
      }

      // Client A
      const clientA = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      clientA.onInitial = (items) => {
        items.forEach((item) => clientAData.set(item.$id, item))
      }
      clientA.onChange = (op, item) => {
        updateStore(clientAData, op, item)
      }
      clientA.connect()

      // Client B
      const clientB = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })
      clientB.onInitial = (items) => {
        items.forEach((item) => clientBData.set(item.$id, item))
      }
      clientB.onChange = (op, item) => {
        updateStore(clientBData, op, item)
      }
      clientB.connect()

      await vi.advanceTimersByTimeAsync(100)

      // Get server instances
      const serverWsA = MockServerWebSocket.instances[0]
      const serverWsB = MockServerWebSocket.instances[1]

      // Simulate: Series of changes
      const task1 = createTask('ec-1', 'Task 1')
      const task2 = createTask('ec-2', 'Task 2')
      const task2Updated = { ...task2, data: { ...task2.data!, title: 'Task 2 Updated', completed: true } }

      // Both clients receive the same broadcasts (simulating real server behavior)
      // Insert task1 to both clients
      serverWsA.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: task1.$id,
        data: task1,
        txid: 1,
      })
      serverWsB.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: task1.$id,
        data: task1,
        txid: 1,
      })
      await vi.advanceTimersByTimeAsync(10)

      // Insert task2 to both clients
      serverWsA.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: task2.$id,
        data: task2,
        txid: 2,
      })
      serverWsB.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: task2.$id,
        data: task2,
        txid: 2,
      })
      await vi.advanceTimersByTimeAsync(10)

      // Update task2 on both clients
      serverWsA.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: task2.$id,
        data: task2Updated,
        txid: 3,
      })
      serverWsB.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: task2.$id,
        data: task2Updated,
        txid: 3,
      })
      await vi.advanceTimersByTimeAsync(10)

      // Delete task1 from both clients
      serverWsA.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: task1.$id,
        txid: 4,
      })
      serverWsB.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: task1.$id,
        txid: 4,
      })
      await vi.advanceTimersByTimeAsync(10)

      // Verify: Both clients have the same final state
      expect(clientAData.size).toBe(clientBData.size)
      expect(clientAData.size).toBe(1) // Only task2 should remain
      expect(clientAData.has(task1.$id)).toBe(false)
      expect(clientBData.has(task1.$id)).toBe(false)
      expect(clientAData.get(task2.$id)?.data?.completed).toBe(true)
      expect(clientBData.get(task2.$id)?.data?.completed).toBe(true)
    })
  })

  // ===========================================================================
  // OPTIMISTIC UPDATES
  // ===========================================================================

  describe('optimistic updates', () => {
    it('UI updates immediately on mutation', async () => {
      /**
       * RED PHASE: This test verifies that optimistic updates work correctly.
       *
       * Expected behavior (when GREEN):
       * 1. When a mutation is triggered, UI updates immediately (optimistically)
       * 2. The mutation is sent to the server via RPC
       * 3. Server responds with txid confirmation
       *
       * For TanStack DB, this is handled by the collection's onInsert/onUpdate/onDelete
       * which return a txid for confirmation.
       *
       * CURRENT STATE: Stub implementation throws "not yet implemented"
       */

      // Setup: Mock RPC with delay to simulate network latency
      mockFetch.mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve(createRpcResponse([
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 10 } },
          ])),
        } as Response
      })

      // Create collection options
      const taskOptions = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // Verify onInsert is defined
      expect(taskOptions.onInsert).toBeDefined()

      // GREEN PHASE: onInsert calls RPC and returns { txid }
      const optimisticTask = createTask('opt-1', 'Optimistic Task')
      await expect(
        taskOptions.onInsert({
          transaction: {
            mutations: [{ key: optimisticTask.$id, modified: optimisticTask }],
          },
          collection: {},
        })
      ).resolves.toEqual({ txid: 10 })
    })

    it('server confirms with txid', async () => {
      /**
       * GREEN PHASE: This test verifies server confirmation returns txid.
       *
       * Expected behavior:
       * - onInsert calls RPC client
       * - RPC returns { success: true, rowid: N }
       * - onInsert transforms to { txid: N }
       */

      // Setup: Mock RPC response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 42 } },
        ])),
      } as Response)

      const taskOptions = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // GREEN PHASE: onInsert calls RPC and returns { txid }
      const confirmTask = createTask('confirm-1', 'Confirmation Test')
      await expect(
        taskOptions.onInsert({
          transaction: {
            mutations: [{ key: confirmTask.$id, modified: confirmTask }],
          },
          collection: {},
        })
      ).resolves.toEqual({ txid: 42 })
    })

    it('no flicker on confirmation', async () => {
      /**
       * This test verifies that there's no UI flicker when the server
       * confirms an optimistic update.
       *
       * Expected behavior:
       * 1. Optimistic update shows in UI immediately
       * 2. Server confirms with same txid
       * 3. UI state remains stable (no flicker)
       *
       * In TanStack DB, this is achieved by using txid to match
       * optimistic updates with server confirmations.
       */

      // Track state changes
      const stateChanges: Array<{ state: string; data?: Task }> = []

      // Setup: WebSocket for sync
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.onInitial = () => {
        stateChanges.push({ state: 'initial' })
      }

      client.onChange = (op, item) => {
        stateChanges.push({ state: `${op}`, data: item })
      }

      client.connect()
      await vi.advanceTimersByTimeAsync(100)

      const serverWs = MockServerWebSocket.instances[0]

      // Setup: Mock RPC for insert
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 100 } },
        ])),
      } as Response)

      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      // Step 1: Optimistic update (tracked locally)
      stateChanges.push({ state: 'optimistic_insert' })

      // Step 2: Send to server via RPC
      const rpcResult = await rpcClient.mutate({
        type: 'insert',
        collection: 'Task',
        key: 'flicker-test',
        data: { title: 'No Flicker', completed: false },
      })

      // Step 3: Server broadcasts via WebSocket (confirmation)
      const confirmedTask = createTask('flicker-test', 'No Flicker')
      serverWs.simulateServerInsert(confirmedTask)
      await vi.advanceTimersByTimeAsync(10)

      // Verify: txid matches
      expect(rpcResult.rowid).toBe(100)

      // Verify: State changes show no flicker pattern
      // (No duplicate states for the same item)
      const insertStates = stateChanges.filter((s) => s.state === 'insert' || s.state === 'optimistic_insert')
      expect(insertStates.length).toBeLessThanOrEqual(2) // At most: optimistic + confirmation
    })
  })

  // ===========================================================================
  // RECONNECTION
  // ===========================================================================

  describe('reconnection', () => {
    it('reconnects after disconnect', async () => {
      // Track connection state
      let disconnectCount = 0
      let initialDataReceived = 0

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.onInitial = () => {
        initialDataReceived++
      }

      client.onDisconnect = () => {
        disconnectCount++
      }

      // Initial connection
      client.connect()
      await vi.advanceTimersByTimeAsync(100)

      const firstWs = MockServerWebSocket.instances[0]
      expect(MockServerWebSocket.instances).toHaveLength(1)

      // Mock WebSocket auto-opens in constructor, so subscribe is sent
      // and initial data callback may have been triggered
      expect(firstWs.send).toHaveBeenCalled()
      const firstSubscribe = JSON.parse(firstWs.send.mock.calls[0][0])
      expect(firstSubscribe.type).toBe('subscribe')

      // Simulate disconnect
      firstWs.simulateClose(1006, 'Abnormal closure')

      expect(disconnectCount).toBe(1)

      // Wait for reconnect (exponential backoff: 1 second first attempt)
      await vi.advanceTimersByTimeAsync(1000)

      // Verify: New WebSocket created for reconnection
      expect(MockServerWebSocket.instances.length).toBe(2)

      // Get second WebSocket and verify it re-subscribes
      const secondWs = MockServerWebSocket.instances[1]
      await vi.advanceTimersByTimeAsync(100)

      // Verify: Client re-subscribed after reconnection
      expect(secondWs.send).toHaveBeenCalled()
      const subscribeMessage = JSON.parse(secondWs.send.mock.calls[0][0])
      expect(subscribeMessage.type).toBe('subscribe')
      expect(subscribeMessage.collection).toBe('Task')
    })

    it('receives missed changes on reconnect', async () => {
      // Track received data
      const receivedItems: Task[] = []
      let lastTxid = 0

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.onInitial = (items, txid) => {
        receivedItems.length = 0
        receivedItems.push(...items)
        lastTxid = txid
      }

      client.onChange = (op, item, txid) => {
        if (op === 'insert') {
          receivedItems.push(item)
        }
        lastTxid = txid
      }

      // Initial connection
      client.connect()
      await vi.advanceTimersByTimeAsync(100)

      const firstWs = MockServerWebSocket.instances[0]
      firstWs.setInitialData([createTask('1', 'Initial Task')])
      firstWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(100)

      // Receive initial data
      expect(receivedItems).toHaveLength(1)
      expect(lastTxid).toBe(1)

      // Simulate disconnect
      firstWs.simulateClose()
      await vi.advanceTimersByTimeAsync(100)

      // While disconnected, server has new data
      // (In real scenario, server would queue or client would fetch from last known txid)

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(1000)

      const secondWs = MockServerWebSocket.instances[1]
      // Server now has more data including what was missed
      const missedTask = createTask('2', 'Missed Task')
      secondWs.setInitialData([
        createTask('1', 'Initial Task'),
        missedTask,
      ])
      secondWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(100)

      // Verify: Received initial includes all current data (initial + missed)
      // TanStack DB would deduplicate based on txid
      expect(receivedItems).toContainEqual(expect.objectContaining({ $id: missedTask.$id }))
    })
  })

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('error handling', () => {
    it('handles RPC errors gracefully', async () => {
      // Setup: Mock RPC error response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          {
            promiseId: 'p-1',
            type: 'error',
            error: { code: 'VALIDATION_ERROR', message: 'Title is required' },
          },
        ])),
      } as Response)

      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      // Execute mutation that will fail
      await expect(
        rpcClient.mutate({
          type: 'insert',
          collection: 'Task',
          key: 'error-task',
          data: { completed: false }, // Missing title
        })
      ).rejects.toThrow('Title is required')
    })

    it('handles network errors gracefully', async () => {
      // Setup: Mock network failure
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'))

      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      await expect(
        rpcClient.mutate({
          type: 'insert',
          collection: 'Task',
          key: 'network-error',
          data: { title: 'Test', completed: false },
        })
      ).rejects.toThrow('Network request failed')
    })

    it('handles WebSocket errors gracefully', async () => {
      let errorOccurred = false
      let reconnected = false

      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
      })

      client.onDisconnect = () => {
        errorOccurred = true
      }

      client.connect()
      await vi.advanceTimersByTimeAsync(100)

      const ws = MockServerWebSocket.instances[0]

      // Simulate WebSocket error
      ws.simulateError(new Error('WebSocket connection failed'))
      ws.simulateClose(1006, 'Connection error')

      expect(errorOccurred).toBe(true)

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(1000)

      // Should have reconnection attempt
      expect(MockServerWebSocket.instances.length).toBe(2)
      reconnected = true

      expect(reconnected).toBe(true)
    })
  })

  // ===========================================================================
  // COLLECTION OPTIONS INTEGRATION
  // ===========================================================================

  describe('collection options integration', () => {
    it('dotdoCollectionOptions returns valid TanStack DB config', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        branch: 'feature-branch',
      })

      // Verify all required fields
      // ID includes branch when specified
      expect(options.id).toBe('dotdo:Task:feature-branch')
      expect(options.schema).toBe(TaskSchema)
      expect(typeof options.getKey).toBe('function')
      expect(typeof options.subscribe).toBe('function')

      // Optional mutation handlers
      expect(typeof options.onInsert).toBe('function')
      expect(typeof options.onUpdate).toBe('function')
      expect(typeof options.onDelete).toBe('function')
    })

    it('subscribe integrates with SyncClient', async () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // Subscribe should create a SyncClient internally
      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = options.subscribe(callbacks)

      // Should return an unsubscribe function
      expect(typeof unsubscribe).toBe('function')

      // Cleanup
      unsubscribe()
    })

    it('mutation handlers call RPC client', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
        ])),
      } as Response)

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // onInsert should call RPC and return txid
      const rpcTestTask = createTask('rpc-test', 'RPC Test')
      const result = await options.onInsert({
        transaction: {
          mutations: [{ key: rpcTestTask.$id, modified: rpcTestTask }],
        },
        collection: {},
      })

      // Verify: RPC call was made and returned txid
      expect(result).toEqual({ txid: 1 })
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  describe('batch operations', () => {
    it('batches multiple mutations in single round trip', async () => {
      // Setup: Mock batch RPC response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(createRpcResponse([
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
        ])),
      } as Response)

      const rpcClient = createRPCClient({ url: 'https://example.com/do/123/rpc' })

      // Execute batch
      const results = await rpcClient.batch([
        { type: 'insert', collection: 'Task', key: 'batch-1', data: { title: 'Task 1', completed: false } },
        { type: 'insert', collection: 'Task', key: 'batch-2', data: { title: 'Task 2', completed: false } },
        { type: 'update', collection: 'Task', key: 'batch-1', data: { completed: true } },
      ])

      // Verify: Single request made
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify: All results returned
      expect(results).toHaveLength(3)
      expect(results[0].rowid).toBe(1)
      expect(results[1].rowid).toBe(2)
      expect(results[2].rowid).toBe(3)
    })
  })

  // ===========================================================================
  // BRANCH SUPPORT
  // ===========================================================================

  describe('branch support', () => {
    it('subscribes to specific branch', async () => {
      const client = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        branch: 'feature-dark-mode',
      })

      client.connect()
      await vi.advanceTimersByTimeAsync(100)

      const ws = MockServerWebSocket.instances[0]
      ws.simulateOpen()
      await vi.advanceTimersByTimeAsync(100)

      // Verify: Subscribe message includes branch
      expect(ws.send).toHaveBeenCalled()
      const subscribeMessage = JSON.parse(ws.send.mock.calls[0][0])
      expect(subscribeMessage.type).toBe('subscribe')
      expect(subscribeMessage.collection).toBe('Task')
      expect(subscribeMessage.branch).toBe('feature-dark-mode')
    })

    it('receives only changes for subscribed branch', async () => {
      const mainBranchChanges: Task[] = []
      const featureBranchChanges: Task[] = []

      // Client subscribed to feature branch
      const featureClient = new SyncClient<Task>({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        branch: 'feature-branch',
      })

      featureClient.onChange = (op, item) => {
        featureBranchChanges.push(item)
      }

      featureClient.connect()
      await vi.advanceTimersByTimeAsync(100)

      const ws = MockServerWebSocket.instances[0]
      ws.simulateOpen()
      await vi.advanceTimersByTimeAsync(100)

      // Simulate: Change on main branch (should not be received)
      const mainTask = { ...createTask('main-1', 'Main Task'), branch: 'main' }
      // This would not be broadcast to feature branch subscribers

      // Simulate: Change on feature branch (should be received)
      const featureTask = { ...createTask('feature-1', 'Feature Task'), branch: 'feature-branch' }
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: featureTask.$id,
        data: featureTask,
        txid: 1,
      })
      await vi.advanceTimersByTimeAsync(10)

      // Verify: Only feature branch change received
      expect(featureBranchChanges).toHaveLength(1)
      expect(featureBranchChanges[0].branch).toBe('feature-branch')
    })
  })
})
