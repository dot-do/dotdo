/**
 * TDD RED Phase - Tests for DO WebSocket Watch Integration
 *
 * These tests verify the integration between:
 * - FileSystemDO WebSocket /watch endpoint
 * - SubscriptionManager from core/watch/subscription.ts
 * - FsModule file change events
 * - BatchEmitter for event coalescing
 *
 * Test coverage:
 * - WebSocket subscription via SubscriptionManager
 * - File changes emit events to WebSocket subscribers
 * - Multiple clients receive same events
 * - Unsubscribe stops events
 * - Connection cleanup
 * - Reconnection with clientId
 * - BatchEmitter integration for event coalescing
 *
 * @module tests/watch/do-integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SubscriptionManager } from '../../core/watch/subscription'
import { BatchEmitter } from '../../core/watch/batch'
import { createWatchEvent, type WatchEvent, type WatchEventType } from '../../core/watch/events'

// ============================================================================
// Mock Types for Testing DO Integration
// ============================================================================

/**
 * Mock WebSocket for testing event delivery
 * Implements the minimal WebSocket interface needed by SubscriptionManager
 */
class MockWebSocket implements Pick<WebSocket, 'send' | 'close' | 'readyState'> {
  readyState: number = 1 // OPEN
  sentMessages: string[] = []
  closeCode?: number
  closeReason?: string

  // Required WebSocket properties (can be stubs for our tests)
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  // Methods
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data as string)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3 // CLOSED
    this.closeCode = code
    this.closeReason = reason
  }

  getLastMessage(): unknown {
    const last = this.sentMessages[this.sentMessages.length - 1]
    return last ? JSON.parse(last) : undefined
  }

  getAllMessages(): unknown[] {
    return this.sentMessages.map((m) => JSON.parse(m))
  }
}

/**
 * Mock FsModule that emits events when files change
 */
class MockFsModule {
  private eventHandlers: Array<(event: WatchEvent) => void> = []

  onEvent(handler: (event: WatchEvent) => void): () => void {
    this.eventHandlers.push(handler)
    return () => {
      const index = this.eventHandlers.indexOf(handler)
      if (index >= 0) {
        this.eventHandlers.splice(index, 1)
      }
    }
  }

  // Simulate file operations that emit events
  async write(path: string, _data: string | Uint8Array): Promise<void> {
    const event = createWatchEvent('modify', path, { size: 100 })
    this.emitEvent(event)
  }

  async create(path: string): Promise<void> {
    const event = createWatchEvent('create', path, { size: 0 })
    this.emitEvent(event)
  }

  async unlink(path: string): Promise<void> {
    const event = createWatchEvent('delete', path)
    this.emitEvent(event)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const event = createWatchEvent('rename', oldPath, newPath, { size: 100 })
    this.emitEvent(event)
  }

  private emitEvent(event: WatchEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }
}

/**
 * Integration bridge that connects FsModule events to SubscriptionManager
 *
 * This class simulates what the FileSystemDO should do:
 * 1. Receive file change events from FsModule
 * 2. Find subscribers via SubscriptionManager
 * 3. Optionally batch events via BatchEmitter
 * 4. Send events to matching WebSockets
 */
class WatchIntegrationBridge {
  private subscriptionManager: SubscriptionManager
  private batchEmitter?: BatchEmitter
  private unsubscribeFsEvents?: () => void

  constructor(
    private fsModule: MockFsModule,
    options: { useBatching?: boolean } = {}
  ) {
    this.subscriptionManager = new SubscriptionManager()

    if (options.useBatching) {
      this.batchEmitter = new BatchEmitter({
        batchWindowMs: 10,
        maxBatchSize: 50,
      })
    }

    this.wireEvents()
  }

  private wireEvents(): void {
    this.unsubscribeFsEvents = this.fsModule.onEvent((event) => {
      this.handleFileEvent(event)
    })

    if (this.batchEmitter) {
      this.batchEmitter.onBatch((events) => {
        for (const event of events) {
          this.broadcastEvent(event)
        }
      })
    }
  }

  private handleFileEvent(event: WatchEvent): void {
    if (this.batchEmitter) {
      // Queue for batching
      this.batchEmitter.queue(event.type, event.path, event.oldPath, {
        size: event.size,
        mtime: event.mtime,
        isDirectory: event.isDirectory,
      })
    } else {
      // Immediate broadcast
      this.broadcastEvent(event)
    }
  }

  private broadcastEvent(event: WatchEvent): void {
    // Find all subscribers that match this path
    const subscribers = this.subscriptionManager.getSubscribersForPath(event.path)

    // Send event to each subscriber
    for (const ws of subscribers) {
      try {
        ws.send(JSON.stringify(event))
      } catch {
        // Connection may be closed
      }
    }
  }

  // Public API for managing subscriptions
  // Use glob pattern matching - subscribe to /path/** to get nested paths
  subscribe(ws: WebSocket, path: string): boolean {
    return this.subscriptionManager.subscribe(ws, path)
  }

  unsubscribe(ws: WebSocket, path: string): boolean {
    return this.subscriptionManager.unsubscribe(ws, path)
  }

  removeConnection(ws: WebSocket): void {
    this.subscriptionManager.removeConnection(ws)
  }

  getSubscribers(path: string): WebSocket[] {
    return this.subscriptionManager.getSubscribersForPath(path)
  }

  flush(): void {
    this.batchEmitter?.flush()
  }

  dispose(): void {
    this.unsubscribeFsEvents?.()
    this.batchEmitter?.dispose()
  }
}

// ============================================================================
// DO WebSocket Integration Tests - RED Phase
// ============================================================================

describe('DO WebSocket Watch Integration', () => {
  let fsModule: MockFsModule
  let bridge: WatchIntegrationBridge
  let ws1: MockWebSocket
  let ws2: MockWebSocket

  beforeEach(() => {
    fsModule = new MockFsModule()
    bridge = new WatchIntegrationBridge(fsModule)
    ws1 = new MockWebSocket()
    ws2 = new MockWebSocket()
  })

  afterEach(() => {
    bridge.dispose()
  })

  describe('WebSocket subscription triggers file watching', () => {
    it('should subscribe WebSocket to receive events for a path', () => {
      // Subscribe with glob pattern to match nested files
      const result = bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')

      expect(result).toBe(true)
      expect(bridge.getSubscribers('/home/user/file.txt')).toContain(ws1)
    })

    it('should not receive events before subscribing', async () => {
      // Modify file without subscribing
      await fsModule.write('/home/user/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(0)
    })

    it('should receive events after subscribing', async () => {
      // Subscribe with glob pattern
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')

      await fsModule.write('/home/user/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(1)
      const event = ws1.getLastMessage() as WatchEvent
      expect(event.type).toBe('modify')
      expect(event.path).toBe('/home/user/file.txt')
    })

    it('should receive create events', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')

      await fsModule.create('/home/user/new-file.txt')

      const event = ws1.getLastMessage() as WatchEvent
      expect(event.type).toBe('create')
      expect(event.path).toBe('/home/user/new-file.txt')
    })

    it('should receive delete events', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')

      await fsModule.unlink('/home/user/deleted.txt')

      const event = ws1.getLastMessage() as WatchEvent
      expect(event.type).toBe('delete')
      expect(event.path).toBe('/home/user/deleted.txt')
    })

    it('should receive rename events with oldPath', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')

      await fsModule.rename('/home/user/old.txt', '/home/user/new.txt')

      const event = ws1.getLastMessage() as WatchEvent
      expect(event.type).toBe('rename')
      expect(event.path).toBe('/home/user/new.txt')
      expect(event.oldPath).toBe('/home/user/old.txt')
    })
  })

  describe('File changes emit events to WebSocket subscribers', () => {
    it('should emit event with correct path', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/data/**')

      await fsModule.write('/data/config.json', '{}')

      const event = ws1.getLastMessage() as WatchEvent
      expect(event.path).toBe('/data/config.json')
    })

    it('should emit event with timestamp', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/data/**')
      const before = Date.now()

      await fsModule.write('/data/config.json', '{}')

      const after = Date.now()
      const event = ws1.getLastMessage() as WatchEvent
      expect(event.timestamp).toBeGreaterThanOrEqual(before)
      expect(event.timestamp).toBeLessThanOrEqual(after)
    })

    it('should emit event with metadata when available', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/data/**')

      await fsModule.write('/data/config.json', '{}')

      const event = ws1.getLastMessage() as WatchEvent
      expect(event.size).toBe(100) // From MockFsModule
    })

    it('should not emit events for paths not subscribed', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')

      await fsModule.write('/tmp/other.txt', 'content')

      expect(ws1.sentMessages.length).toBe(0)
    })

    it('should emit events for nested paths when subscribed to parent', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/**')

      await fsModule.write('/home/user/docs/file.txt', 'content')

      const event = ws1.getLastMessage() as WatchEvent
      expect(event.path).toBe('/home/user/docs/file.txt')
    })
  })

  describe('Multiple clients receive same events', () => {
    it('should broadcast events to all subscribers of a path', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/shared/**')
      bridge.subscribe(ws2 as unknown as WebSocket, '/shared/**')

      await fsModule.write('/shared/data.txt', 'content')

      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(1)

      const event1 = ws1.getLastMessage() as WatchEvent
      const event2 = ws2.getLastMessage() as WatchEvent
      expect(event1.path).toBe(event2.path)
      expect(event1.type).toBe(event2.type)
    })

    it('should handle different subscriptions for different clients', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user1/**')
      bridge.subscribe(ws2 as unknown as WebSocket, '/home/user2/**')

      await fsModule.write('/home/user1/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(0) // Different path
    })

    it('should handle overlapping subscriptions', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/**')
      bridge.subscribe(ws2 as unknown as WebSocket, '/home/user/**')

      await fsModule.write('/home/user/file.txt', 'content')

      // Both should receive the event
      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(1)
    })

    it('should handle many concurrent subscribers', async () => {
      const sockets = Array.from({ length: 100 }, () => new MockWebSocket())

      for (const socket of sockets) {
        bridge.subscribe(socket as unknown as WebSocket, '/broadcast/**')
      }

      await fsModule.write('/broadcast/message.txt', 'hello')

      for (const socket of sockets) {
        expect(socket.sentMessages.length).toBe(1)
      }
    })
  })

  describe('Unsubscribe stops events', () => {
    it('should stop receiving events after unsubscribe', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/user/**')
      await fsModule.write('/home/user/file1.txt', 'content')
      expect(ws1.sentMessages.length).toBe(1)

      bridge.unsubscribe(ws1 as unknown as WebSocket, '/home/user/**')
      await fsModule.write('/home/user/file2.txt', 'content')

      expect(ws1.sentMessages.length).toBe(1) // No new messages
    })

    it('should only stop events for unsubscribed path', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/path/a/**')
      bridge.subscribe(ws1 as unknown as WebSocket, '/path/b/**')

      bridge.unsubscribe(ws1 as unknown as WebSocket, '/path/a/**')

      await fsModule.write('/path/a/file.txt', 'content')
      await fsModule.write('/path/b/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(1) // Only from /path/b
      const event = ws1.getLastMessage() as WatchEvent
      expect(event.path).toBe('/path/b/file.txt')
    })

    it('should not affect other subscribers when one unsubscribes', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/shared/**')
      bridge.subscribe(ws2 as unknown as WebSocket, '/shared/**')

      bridge.unsubscribe(ws1 as unknown as WebSocket, '/shared/**')

      await fsModule.write('/shared/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(0)
      expect(ws2.sentMessages.length).toBe(1)
    })

    it('should handle unsubscribing from non-subscribed path', () => {
      const result = bridge.unsubscribe(ws1 as unknown as WebSocket, '/not/subscribed')

      expect(result).toBe(false) // Was not subscribed
    })
  })

  describe('Connection cleanup on close', () => {
    it('should remove all subscriptions on connection close', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/path/a/**')
      bridge.subscribe(ws1 as unknown as WebSocket, '/path/b/**')

      bridge.removeConnection(ws1 as unknown as WebSocket)

      expect(bridge.getSubscribers('/path/a/file.txt')).not.toContain(ws1)
      expect(bridge.getSubscribers('/path/b/file.txt')).not.toContain(ws1)
    })

    it('should not affect other connections on cleanup', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/shared/**')
      bridge.subscribe(ws2 as unknown as WebSocket, '/shared/**')

      bridge.removeConnection(ws1 as unknown as WebSocket)

      expect(bridge.getSubscribers('/shared/file.txt')).toContain(ws2)
      expect(bridge.getSubscribers('/shared/file.txt')).not.toContain(ws1)
    })

    it('should handle cleanup of already closed connection', () => {
      // Should not throw
      expect(() => bridge.removeConnection(ws1 as unknown as WebSocket)).not.toThrow()
    })

    it('should stop events after connection cleanup', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/**')
      bridge.removeConnection(ws1 as unknown as WebSocket)

      await fsModule.write('/home/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(0)
    })
  })

  describe('Reconnection handling', () => {
    it('should allow re-subscribing after unsubscribe', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/**')
      bridge.unsubscribe(ws1 as unknown as WebSocket, '/home/**')
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/**')

      await fsModule.write('/home/file.txt', 'content')

      expect(ws1.sentMessages.length).toBe(1)
    })

    it('should allow new connection to subscribe to same path', async () => {
      bridge.subscribe(ws1 as unknown as WebSocket, '/home/**')
      bridge.removeConnection(ws1 as unknown as WebSocket)

      const ws3 = new MockWebSocket()
      bridge.subscribe(ws3 as unknown as WebSocket, '/home/**')

      await fsModule.write('/home/file.txt', 'content')

      expect(ws3.sentMessages.length).toBe(1)
      expect(ws1.sentMessages.length).toBe(0)
    })

    it('should restore subscriptions on reconnect by clientId', async () => {
      // This test documents the expected behavior for clientId-based reconnection
      // The actual implementation would need to store subscriptions by clientId
      const clientId = 'client-123'
      const subscriptions = new Map<string, string[]>()

      // Simulate storing subscriptions for a client
      subscriptions.set(clientId, ['/home/user/**', '/tmp/**'])

      // Client reconnects
      const storedPaths = subscriptions.get(clientId)
      expect(storedPaths).toEqual(['/home/user/**', '/tmp/**'])

      // Re-subscribe to stored paths
      const ws3 = new MockWebSocket()
      for (const path of storedPaths || []) {
        bridge.subscribe(ws3 as unknown as WebSocket, path)
      }

      await fsModule.write('/home/user/file.txt', 'content')
      expect(ws3.sentMessages.length).toBe(1)
    })
  })
})

// ============================================================================
// BatchEmitter Integration Tests
// ============================================================================

describe('BatchEmitter Integration with DO WebSocket Watch', () => {
  let fsModule: MockFsModule
  let bridge: WatchIntegrationBridge
  let ws: MockWebSocket

  beforeEach(() => {
    fsModule = new MockFsModule()
    bridge = new WatchIntegrationBridge(fsModule, { useBatching: true })
    ws = new MockWebSocket()
  })

  afterEach(() => {
    bridge.dispose()
  })

  it('should batch multiple events before sending', async () => {
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    // Trigger multiple events rapidly
    await fsModule.write('/home/file1.txt', 'a')
    await fsModule.write('/home/file2.txt', 'b')
    await fsModule.write('/home/file3.txt', 'c')

    // Events should be queued, not sent yet
    expect(ws.sentMessages.length).toBe(0)

    // Flush to send batched events
    bridge.flush()

    // Now we should have events (possibly coalesced)
    expect(ws.sentMessages.length).toBeGreaterThan(0)
  })

  it('should coalesce events to same path', async () => {
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    // Multiple modifications to same file
    await fsModule.write('/home/file.txt', 'a')
    await fsModule.write('/home/file.txt', 'b')
    await fsModule.write('/home/file.txt', 'c')

    bridge.flush()

    // Should be coalesced to single event
    const events = ws.getAllMessages() as WatchEvent[]
    const fileEvents = events.filter((e) => e.path === '/home/file.txt')
    expect(fileEvents.length).toBe(1)
  })

  it('should preserve different paths in batch', async () => {
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    await fsModule.write('/home/file1.txt', 'a')
    await fsModule.write('/home/file2.txt', 'b')
    await fsModule.write('/home/file3.txt', 'c')

    bridge.flush()

    const events = ws.getAllMessages() as WatchEvent[]
    const paths = events.map((e) => e.path)
    expect(paths).toContain('/home/file1.txt')
    expect(paths).toContain('/home/file2.txt')
    expect(paths).toContain('/home/file3.txt')
  })

  it('should prioritize delete events over modify events', async () => {
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    await fsModule.write('/home/modify.txt', 'a')
    await fsModule.unlink('/home/delete.txt')
    await fsModule.create('/home/create.txt')

    bridge.flush()

    const events = ws.getAllMessages() as WatchEvent[]

    // Find indices
    const deleteIndex = events.findIndex((e) => e.type === 'delete')
    const createIndex = events.findIndex((e) => e.type === 'create')
    const modifyIndex = events.findIndex((e) => e.type === 'modify')

    // Delete should come first (highest priority)
    expect(deleteIndex).toBeLessThan(createIndex)
    expect(deleteIndex).toBeLessThan(modifyIndex)
  })

  it('should auto-flush when batch window expires', async () => {
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    await fsModule.write('/home/file.txt', 'content')

    // Wait for batch window (10ms + buffer)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should have auto-flushed
    expect(ws.sentMessages.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('DO WebSocket Watch Error Handling', () => {
  let fsModule: MockFsModule
  let bridge: WatchIntegrationBridge

  beforeEach(() => {
    fsModule = new MockFsModule()
    bridge = new WatchIntegrationBridge(fsModule)
  })

  afterEach(() => {
    bridge.dispose()
  })

  it('should handle closed WebSocket gracefully', async () => {
    const ws = new MockWebSocket()
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    // Close the WebSocket
    ws.close()

    // Should not throw when trying to send
    await expect(fsModule.write('/home/file.txt', 'content')).resolves.not.toThrow()
  })

  it('should handle WebSocket send errors gracefully', async () => {
    const ws = new MockWebSocket()
    bridge.subscribe(ws as unknown as WebSocket, '/home/**')

    // Override send to throw
    ws.send = () => {
      throw new Error('Connection lost')
    }

    // Should not throw when file changes
    await expect(fsModule.write('/home/file.txt', 'content')).resolves.not.toThrow()
  })

  it('should continue sending to other subscribers if one fails', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    bridge.subscribe(ws1 as unknown as WebSocket, '/shared/**')
    bridge.subscribe(ws2 as unknown as WebSocket, '/shared/**')

    // Make ws1 fail
    ws1.send = () => {
      throw new Error('Connection lost')
    }

    await fsModule.write('/shared/file.txt', 'content')

    // ws2 should still receive the event
    expect(ws2.sentMessages.length).toBe(1)
  })
})
