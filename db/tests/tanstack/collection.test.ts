/**
 * TanStack DB Collection Options Factory Tests
 *
 * Tests for the dotdoCollectionOptions() factory that creates TanStack DB
 * compatible collection options for dotdo sync.
 *
 * The factory provides:
 * - id: Unique collection identifier (dotdo:${name})
 * - getKey: Extract $id from items
 * - sync: WebSocket sync function for real-time updates
 * - onInsert/onUpdate/onDelete: RPC mutation handlers (via createCollectionOptions)
 *
 * @module db/tests/tanstack/collection.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  dotdoCollectionOptions,
  createCollectionOptions,
  CollectionOptions,
  type TanStackSyncContext,
  type DotdoCollectionOptionsConfig,
  type CollectionCallbacks,
} from '../../tanstack/collection'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
  url: string
  // Event handlers stored by addEventListener
  _handlers: {
    open: Set<() => void>
    close: Set<() => void>
    error: Set<(error: Error) => void>
    message: Set<(event: { data: string }) => void>
  }
  // Trigger event methods
  triggerOpen(): void
  triggerClose(): void
  triggerError(error: Error): void
  triggerMessage(data: string): void
}

const createMockWebSocket = (url: string): MockWebSocket => {
  const socket: MockWebSocket = {
    url,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 0, // WebSocket.CONNECTING initially
    _handlers: {
      open: new Set(),
      close: new Set(),
      error: new Set(),
      message: new Set(),
    },
    addEventListener: vi.fn(function(event: string, handler: (...args: unknown[]) => void) {
      const handlers = socket._handlers[event as keyof typeof socket._handlers]
      if (handlers) {
        handlers.add(handler as never)
      }
    }),
    removeEventListener: vi.fn(),
    triggerOpen() {
      socket.readyState = 1 // WebSocket.OPEN
      for (const handler of socket._handlers.open) {
        handler()
      }
    },
    triggerClose() {
      socket.readyState = 3 // WebSocket.CLOSED
      for (const handler of socket._handlers.close) {
        handler()
      }
    },
    triggerError(error: Error) {
      for (const handler of socket._handlers.error) {
        handler(error)
      }
    },
    triggerMessage(data: string) {
      for (const handler of socket._handlers.message) {
        handler({ data })
      }
    },
  }
  return socket
}

let mockWebSocket: MockWebSocket
let originalWebSocket: typeof globalThis.WebSocket

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket

  // Create mock WebSocket constructor with static constants
  const MockWebSocketConstructor = vi.fn((url: string) => {
    mockWebSocket = createMockWebSocket(url)
    return mockWebSocket
  }) as unknown as typeof WebSocket

  // Add static constants that WebSocket uses
  Object.assign(MockWebSocketConstructor, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  })

  globalThis.WebSocket = MockWebSocketConstructor
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
})

// ============================================================================
// MOCK SYNC CONTEXT
// ============================================================================

function createMockSyncContext(): TanStackSyncContext & {
  beginCalls: number
  writeCalls: Array<{ type: string; value?: unknown; key?: string }>
  commitCalls: number
  markReadyCalls: number
} {
  return {
    beginCalls: 0,
    writeCalls: [],
    commitCalls: 0,
    markReadyCalls: 0,
    begin() {
      this.beginCalls++
    },
    write(mutation) {
      this.writeCalls.push(mutation)
    },
    commit() {
      this.commitCalls++
    },
    markReady() {
      this.markReadyCalls++
    },
  }
}

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestTask {
  $id: string
  name: string
  status?: string
}

// ============================================================================
// dotdoCollectionOptions() TESTS
// ============================================================================

describe('dotdoCollectionOptions()', () => {
  describe('collection options structure', () => {
    it('creates TanStack DB compatible collection options', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      expect(options).toBeDefined()
      expect(options.id).toBeDefined()
      expect(typeof options.getKey).toBe('function')
      expect(typeof options.sync).toBe('function')
    })

    it('uses dotdo:${name} as collection id', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      expect(options.id).toBe('dotdo:Task')
    })

    it('includes branch in collection id when provided', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
        branch: 'feature/new-ui',
      })

      expect(options.id).toBe('dotdo:Task:feature/new-ui')
    })

    it('extracts $id as the key', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const key = options.getKey({ $id: 'task-123', name: 'Test Task' })
      expect(key).toBe('task-123')
    })
  })

  describe('validation', () => {
    it('throws error for empty collection name', () => {
      expect(() =>
        dotdoCollectionOptions({
          name: '',
          doUrl: 'https://example.do/api',
        })
      ).toThrow('Collection name cannot be empty')
    })

    it('throws error for whitespace-only collection name', () => {
      expect(() =>
        dotdoCollectionOptions({
          name: '   ',
          doUrl: 'https://example.do/api',
        })
      ).toThrow('Collection name cannot be empty')
    })

    it('throws error for invalid URL', () => {
      expect(() =>
        dotdoCollectionOptions({
          name: 'Task',
          doUrl: 'not-a-valid-url',
        })
      ).toThrow('Invalid URL')
    })
  })

  describe('sync function', () => {
    it('creates WebSocket connection to sync endpoint', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      expect(globalThis.WebSocket).toHaveBeenCalled()
      // URL should be converted from https to wss and have /sync appended
      expect(mockWebSocket.url).toMatch(/^wss:/)
      expect(mockWebSocket.url).toContain('/sync')
    })

    it('converts http/https URLs to ws/wss for WebSocket', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      expect(mockWebSocket.url).toBe('wss://example.do/api/sync')
    })

    it('returns cleanup function', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      const cleanup = options.sync(mockContext)

      expect(typeof cleanup).toBe('function')
    })

    it('cleanup function disconnects WebSocket', () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      const cleanup = options.sync(mockContext)

      cleanup()

      expect(mockWebSocket.close).toHaveBeenCalled()
    })
  })

  // NOTE: Initial state and change handling tests require end-to-end integration
  // tests with a real WebSocket connection. The SyncClient message handling is
  // tested in db/tanstack/tests/sync-engine.test.ts with proper mocking.
  // Here we verify that the sync function is properly wired up.
  describe('initial state handling', () => {
    it.skip('writes initial items on connection (requires e2e test)', async () => {
      // This test requires proper WebSocket message event simulation
      // See db/tanstack/tests/integration/live-query.test.ts for e2e coverage
    })

    it.skip('handles empty initial state (requires e2e test)', async () => {
      // This test requires proper WebSocket message event simulation
      // See db/tanstack/tests/integration/live-query.test.ts for e2e coverage
    })
  })

  describe('change handling', () => {
    it('handles insert changes', async () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      mockWebSocket.triggerOpen()
      await new Promise(r => setTimeout(r, 10))
      await vi.waitFor(() => {
        expect(mockWebSocket.send).toHaveBeenCalled()
      }, { timeout: 200 })

      mockWebSocket.triggerMessage(JSON.stringify({
        type: 'insert',
        collection: 'Task',
        branch: null,
        key: 'task-new',
        data: { $id: 'task-new', name: 'New Task' },
        txid: 101,
      }))

      expect(mockContext.writeCalls).toContainEqual({
        type: 'insert',
        value: { $id: 'task-new', name: 'New Task' },
      })
    })

    it('handles update changes', async () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      mockWebSocket.triggerOpen()
      await new Promise(r => setTimeout(r, 10))
      await vi.waitFor(() => {
        expect(mockWebSocket.send).toHaveBeenCalled()
      }, { timeout: 200 })

      mockWebSocket.triggerMessage(JSON.stringify({
        type: 'update',
        collection: 'Task',
        branch: null,
        key: 'task-1',
        data: { $id: 'task-1', name: 'Updated Task' },
        txid: 102,
      }))

      expect(mockContext.writeCalls).toContainEqual({
        type: 'update',
        value: { $id: 'task-1', name: 'Updated Task' },
      })
    })

    it('handles delete changes', async () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      mockWebSocket.triggerOpen()
      await new Promise(r => setTimeout(r, 10))
      await vi.waitFor(() => {
        expect(mockWebSocket.send).toHaveBeenCalled()
      }, { timeout: 200 })

      mockWebSocket.triggerMessage(JSON.stringify({
        type: 'delete',
        collection: 'Task',
        branch: null,
        key: 'task-1',
        txid: 103,
      }))

      expect(mockContext.writeCalls).toContainEqual({
        type: 'delete',
        key: 'task-1',
      })
    })

    it('commits each change', async () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      mockWebSocket.triggerOpen()
      await new Promise(r => setTimeout(r, 10))
      await vi.waitFor(() => {
        expect(mockWebSocket.send).toHaveBeenCalled()
      }, { timeout: 200 })

      // Send multiple changes
      mockWebSocket.triggerMessage(JSON.stringify({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', name: 'Task 1' },
        txid: 101,
      }))

      mockWebSocket.triggerMessage(JSON.stringify({
        type: 'update',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', name: 'Updated' },
        txid: 102,
      }))

      // Each change should trigger begin + commit
      expect(mockContext.beginCalls).toBeGreaterThanOrEqual(2)
      expect(mockContext.commitCalls).toBeGreaterThanOrEqual(2)
    })
  })

  describe('subscription', () => {
    it('subscribes to collection on connect', async () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      mockWebSocket.triggerOpen()

      await new Promise(r => setTimeout(r, 10))
      await vi.waitFor(() => {
        expect(mockWebSocket.send).toHaveBeenCalled()
      }, { timeout: 200 })

      const sentMessage = JSON.parse(mockWebSocket.send.mock.calls[0][0] as string)
      expect(sentMessage.type).toBe('subscribe')
      expect(sentMessage.collection).toBe('Task')
    })

    it('includes branch in subscription when provided', async () => {
      const options = dotdoCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
        branch: 'feature/test',
      })

      const mockContext = createMockSyncContext()
      options.sync(mockContext)

      mockWebSocket.triggerOpen()

      await new Promise(r => setTimeout(r, 10))
      await vi.waitFor(() => {
        expect(mockWebSocket.send).toHaveBeenCalled()
      }, { timeout: 200 })

      const sentMessage = JSON.parse(mockWebSocket.send.mock.calls[0][0] as string)
      expect(sentMessage.branch).toBe('feature/test')
    })
  })
})

// ============================================================================
// createCollectionOptions() TESTS (extended options with mutation handlers)
// ============================================================================

describe('createCollectionOptions()', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes base options from dotdoCollectionOptions', () => {
    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    expect(options.id).toBe('dotdo:Task')
    expect(typeof options.getKey).toBe('function')
    expect(typeof options.sync).toBe('function')
  })

  it('includes onInsert mutation handler', () => {
    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    expect(typeof options.onInsert).toBe('function')
  })

  it('includes onUpdate mutation handler', () => {
    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    expect(typeof options.onUpdate).toBe('function')
  })

  it('includes onDelete mutation handler', () => {
    const options = createCollectionOptions<TestTask>({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    expect(typeof options.onDelete).toBe('function')
  })

  describe('onInsert', () => {
    it('calls RPC to create item', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'req-1',
          type: 'batch',
          results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
        }),
      })

      const options = createCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const result = await options.onInsert({
        transaction: {
          mutations: [
            { key: 'task-1', modified: { $id: 'task-1', name: 'New Task' } },
          ],
        },
        collection: {},
      })

      expect(mockFetch).toHaveBeenCalled()
      expect(result).toHaveProperty('txid')
    })
  })

  describe('onUpdate', () => {
    it('calls RPC to update item', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'req-1',
          type: 'batch',
          results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 2 } }],
        }),
      })

      const options = createCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const result = await options.onUpdate({
        transaction: {
          mutations: [
            { key: 'task-1', changes: { name: 'Updated Name' } },
          ],
        },
        collection: {},
      })

      expect(mockFetch).toHaveBeenCalled()
      expect(result).toHaveProperty('txid')
    })
  })

  describe('onDelete', () => {
    it('calls RPC to delete item', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'req-1',
          type: 'batch',
          results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 3 } }],
        }),
      })

      const options = createCollectionOptions<TestTask>({
        name: 'Task',
        doUrl: 'https://example.do/api',
      })

      const result = await options.onDelete({
        transaction: {
          mutations: [{ key: 'task-1' }],
        },
        collection: {},
      })

      expect(mockFetch).toHaveBeenCalled()
      expect(result).toHaveProperty('txid')
    })
  })
})

// ============================================================================
// CollectionOptions() TESTS (callback-style API)
// ============================================================================

describe('CollectionOptions() callback-style API', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates collection with subscribe method', () => {
    const options = CollectionOptions<TestTask>({
      doUrl: 'https://example.do/api',
      collection: 'Task',
    })

    expect(options.id).toBe('dotdo:Task')
    expect(typeof options.getKey).toBe('function')
    expect(typeof options.subscribe).toBe('function')
  })

  it('includes branch in id when provided', () => {
    const options = CollectionOptions<TestTask>({
      doUrl: 'https://example.do/api',
      collection: 'Task',
      branch: 'dev',
    })

    expect(options.id).toBe('dotdo:Task:dev')
  })

  it('validates empty collection name', () => {
    expect(() =>
      CollectionOptions({
        doUrl: 'https://example.do/api',
        collection: '',
      })
    ).toThrow('Collection name cannot be empty')
  })

  it('validates invalid URL', () => {
    expect(() =>
      CollectionOptions({
        doUrl: 'not-valid',
        collection: 'Task',
      })
    ).toThrow('Invalid URL')
  })

  it('subscribe returns unsubscribe function', () => {
    const options = CollectionOptions<TestTask>({
      doUrl: 'https://example.do/api',
      collection: 'Task',
    })

    const callbacks: CollectionCallbacks<TestTask> = {
      begin: vi.fn(),
      onData: vi.fn(),
      onInsert: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      commit: vi.fn(),
    }

    const unsubscribe = options.subscribe(callbacks)
    expect(typeof unsubscribe).toBe('function')

    // Cleanup
    unsubscribe()
  })

  it('includes mutation handlers', () => {
    const options = CollectionOptions<TestTask>({
      doUrl: 'https://example.do/api',
      collection: 'Task',
    })

    expect(typeof options.onInsert).toBe('function')
    expect(typeof options.onUpdate).toBe('function')
    expect(typeof options.onDelete).toBe('function')
  })
})
