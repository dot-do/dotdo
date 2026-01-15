/**
 * Streaming Error Handling Tests (TDD RED Phase)
 *
 * Tests for empty catch blocks in streaming/ directory.
 * These tests are designed to FAIL because the current implementation
 * silently swallows errors in catch blocks.
 *
 * @issue do-1jir - [RED] Empty Catch Block Tests (Streaming)
 * @phase TDD RED - Write failing tests ONLY
 *
 * Empty catch blocks identified:
 * 1. event-stream-do.ts:1701 - WebSocket message JSON parse errors silently ignored
 * 2. fan-out-manager.ts:181,225,249,274 - WebSocket send failures silently swallowed
 * 3. stream-bridge.ts:416 - Transform errors silently skipped
 * 4. stream-bridge.ts:481 - Close flush errors silently ignored
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// IMPORTS
// ============================================================================

import { EventStreamDO } from './event-stream-do'
import { FanOutManager, type IFanOutManager } from './event-stream/fan-out-manager'
import { ConnectionManager, type IConnectionManager } from './event-stream/connection-manager'
import { StreamBridge, type StreamBridgeConfig, type StreamEvent } from './stream-bridge'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './tests/utils/websocket-mock'
installWebSocketMock()

// ============================================================================
// TEST 1: EVENT-STREAM-DO - WEBSOCKET JSON PARSE ERROR HANDLING
// ============================================================================

/**
 * File: streaming/event-stream-do.ts
 * Line: 1701
 *
 * Current behavior (BROKEN):
 *   } catch {
 *     // Ignore invalid JSON
 *   }
 *
 * Expected behavior:
 * - Should emit an error event or call error handler
 * - Should log the parse error with context
 * - Should track parse failures in metrics
 */
describe('EventStreamDO WebSocket JSON Parse Error Handling', () => {
  let mockState: any
  let eventStreamDO: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()

    const storage = new Map<string, unknown>()
    const alarms: number[] = []

    mockState = {
      storage: {
        get: vi.fn(async (key: string) => storage.get(key)),
        put: vi.fn(async (key: string, value: unknown) => storage.set(key, value)),
        delete: vi.fn(async (key: string) => storage.delete(key)),
        deleteAll: vi.fn(async () => storage.clear()),
        list: vi.fn(async () => storage),
      },
      waitUntil: vi.fn(),
      setAlarm: vi.fn((timestamp: number) => alarms.push(timestamp)),
      getAlarm: vi.fn(async () => alarms[0]),
      deleteAlarm: vi.fn(async () => { alarms.length = 0 }),
      getWebSockets: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
      _storage: storage,
      _alarms: alarms,
    }

    eventStreamDO = new EventStreamDO(mockState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should emit parse error event for malformed WebSocket JSON message', async () => {
    // Arrange - track error events
    const errorEvents: Error[] = []
    const originalConsoleError = console.error
    console.error = vi.fn((...args) => {
      if (args[0] instanceof Error) {
        errorEvents.push(args[0])
      }
    })

    // Create a mock WebSocket
    const mockWs: any = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    // Act - send invalid JSON via webSocketMessage
    await eventStreamDO.webSocketMessage(mockWs, 'this is not valid JSON {{{')

    // Restore console
    console.error = originalConsoleError

    // Assert - CURRENTLY FAILS because error is silently swallowed
    // Expected: At least one error should be logged
    expect(errorEvents.length).toBeGreaterThan(0)
  })

  it('should track parse failure in metrics/statistics', async () => {
    // Arrange
    const mockWs: any = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    // Act - send multiple invalid messages
    await eventStreamDO.webSocketMessage(mockWs, 'invalid json 1')
    await eventStreamDO.webSocketMessage(mockWs, 'invalid json 2')
    await eventStreamDO.webSocketMessage(mockWs, '{ incomplete')

    // Assert - CURRENTLY FAILS because no metrics are tracked
    // We need to expose metrics - this test validates the expected behavior
    const metrics = (eventStreamDO as any).getMetrics?.() ?? (eventStreamDO as any).metrics ?? {}
    expect(metrics.parseErrors ?? 0).toBe(3)
  })

  it('should send error response to WebSocket on parse failure', async () => {
    // Arrange
    const mockWs: any = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    // Act - send invalid JSON
    await eventStreamDO.webSocketMessage(mockWs, 'not json at all')

    // Assert - CURRENTLY FAILS because error is silently swallowed
    // Expected: Should send error message back to client
    expect(mockWs.send).toHaveBeenCalled()
    const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sentMessage.type).toBe('error')
    expect(sentMessage.code).toBe('PARSE_ERROR')
  })
})

// ============================================================================
// TEST 2: FAN-OUT-MANAGER - WEBSOCKET SEND FAILURE TRACKING
// ============================================================================

/**
 * File: streaming/event-stream/fan-out-manager.ts
 * Lines: 181, 225, 249, 274
 *
 * Current behavior (BROKEN):
 *   } catch {
 *     failed++
 *     // We can't easily get the connection ID from the WebSocket
 *   }
 *
 * Expected behavior:
 * - Should track failed connection IDs
 * - Should emit failure events for monitoring
 * - Should log send errors with connection context
 * - Should provide failed connections in result for retry logic
 */
describe('FanOutManager WebSocket Send Failure Tracking', () => {
  let fanOut: IFanOutManager
  let connectionManager: IConnectionManager

  beforeEach(() => {
    connectionManager = new ConnectionManager()
    fanOut = new FanOutManager(connectionManager)
  })

  // Helper to create mock WebSocket that throws on send
  function createFailingWebSocket(): WebSocket {
    const mock: any = {
      send: vi.fn(() => {
        throw new Error('WebSocket send failed: connection reset')
      }),
      close: vi.fn(),
      readyState: 1, // OPEN
    }
    return mock as WebSocket
  }

  function createWorkingWebSocket(): WebSocket {
    const sentMessages: string[] = []
    const mock: any = {
      send: vi.fn((data: string) => sentMessages.push(data)),
      close: vi.fn(),
      readyState: 1, // OPEN
      _sentMessages: sentMessages,
    }
    return mock as WebSocket
  }

  it('should return failed connection IDs in broadcast result', async () => {
    // Arrange - mix of working and failing connections
    const ws1 = createWorkingWebSocket()
    const ws2 = createFailingWebSocket()
    const ws3 = createWorkingWebSocket()
    const ws4 = createFailingWebSocket()

    connectionManager.addConnection(ws1, ['orders'])
    connectionManager.addConnection(ws2, ['orders'])
    connectionManager.addConnection(ws3, ['orders'])
    connectionManager.addConnection(ws4, ['orders'])

    // Act
    const result = await fanOut.broadcast('orders', { type: 'test' })

    // Assert - CURRENTLY FAILS because failedConnections is always empty
    // Line 181: catch block doesn't populate failedConnections array
    expect(result.failedConnections).toBeDefined()
    expect(result.failedConnections.length).toBe(2)
    expect(result.delivered).toBe(2)
    expect(result.failed).toBe(2)
  })

  it('should emit error event for each send failure', async () => {
    // Arrange
    const errorEvents: Array<{ connectionId: string; error: Error }> = []
    const onSendError = vi.fn((connId: string, err: Error) => {
      errorEvents.push({ connectionId: connId, error: err })
    })

    // Create fan-out with error handler (if supported)
    const customFanOut = new FanOutManager(connectionManager, { onSendError })

    const ws1 = createFailingWebSocket()
    connectionManager.addConnection(ws1, ['orders'])

    // Act
    await customFanOut.broadcast('orders', { type: 'test' })

    // Assert - CURRENTLY FAILS because no error events emitted
    expect(onSendError).toHaveBeenCalled()
    expect(errorEvents.length).toBe(1)
    expect(errorEvents[0].error.message).toContain('connection reset')
  })

  it('should log send errors with connection context', async () => {
    // Arrange
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ws1 = createFailingWebSocket()
    connectionManager.addConnection(ws1, ['orders'])

    // Act
    await fanOut.broadcast('orders', { type: 'test' })

    // Assert - CURRENTLY FAILS because errors are silently swallowed
    expect(consoleWarnSpy).toHaveBeenCalled()
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('send failed')

    consoleWarnSpy.mockRestore()
  })

  it('should track failure metrics in broadcastBatch', async () => {
    // Arrange - Line 225: broadcastBatch catch block
    const ws1 = createFailingWebSocket()
    connectionManager.addConnection(ws1, ['orders'])

    // Act
    const count = await fanOut.broadcastBatch([
      { topic: 'orders', message: { type: 'event1' } },
      { topic: 'orders', message: { type: 'event2' } },
    ])

    // Assert - CURRENTLY FAILS because failures aren't tracked
    // broadcastBatch returns count but doesn't distinguish failures
    expect(count).toBe(0) // All failed
    const metrics = (fanOut as any).getMetrics?.() ?? {}
    expect(metrics.sendFailures ?? -1).toBe(2) // Should track failure count
  })

  it('should track sendToConnection failure', async () => {
    // Arrange - Line 249
    const ws1 = createFailingWebSocket()
    const connId = connectionManager.addConnection(ws1, ['orders'])

    // Track if error was captured
    let capturedError: Error | null = null
    const originalWarn = console.warn
    console.warn = vi.fn((msg, err) => {
      if (err instanceof Error) capturedError = err
    })

    // Act
    const result = await fanOut.sendToConnection(connId, { type: 'test' })

    console.warn = originalWarn

    // Assert - Currently returns false but error context is lost
    expect(result).toBe(false)
    // FAILS: Should log/emit the actual error
    expect(capturedError).not.toBeNull()
    expect(capturedError?.message).toContain('connection reset')
  })

  it('should track sendToConnections failures with details', async () => {
    // Arrange - Line 274
    const ws1 = createWorkingWebSocket()
    const ws2 = createFailingWebSocket()
    const ws3 = createFailingWebSocket()

    const conn1 = connectionManager.addConnection(ws1, ['orders'])
    const conn2 = connectionManager.addConnection(ws2, ['orders'])
    const conn3 = connectionManager.addConnection(ws3, ['orders'])

    // Act
    const successCount = await fanOut.sendToConnections([conn1, conn2, conn3], { type: 'test' })

    // Assert
    expect(successCount).toBe(1) // Only 1 succeeded

    // FAILS: Should expose which connections failed
    const result = (fanOut as any).lastSendResult ?? {}
    expect(result.failedConnectionIds).toContain(conn2)
    expect(result.failedConnectionIds).toContain(conn3)
  })
})

// ============================================================================
// TEST 3: STREAM-BRIDGE - TRANSFORM ERROR HANDLING
// ============================================================================

/**
 * File: streaming/stream-bridge.ts
 * Line: 416
 *
 * Current behavior (BROKEN):
 *   } catch {
 *     // On transform error, skip the problematic event but continue with others
 *     // This matches test expectation: "should handle transform errors gracefully"
 *   }
 *
 * Expected behavior:
 * - Should call onTransformError callback if provided
 * - Should log transform errors with event context
 * - Should track transform failure count
 */
describe('StreamBridge Transform Error Handling', () => {
  let mockPipeline: {
    send: ReturnType<typeof vi.fn>
    events: unknown[]
    setError: (err: Error | null) => void
  }

  beforeEach(() => {
    vi.useFakeTimers()
    const events: unknown[] = []
    let error: Error | null = null

    mockPipeline = {
      send: vi.fn(async (batch: unknown[]) => {
        if (error) throw error
        events.push(...batch)
      }),
      events,
      setError: (err: Error | null) => { error = err },
    }
  })

  afterEach(async () => {
    vi.useRealTimers()
  })

  it('should call onTransformError callback when transform throws', async () => {
    // Arrange
    const transformErrors: Array<{ event: StreamEvent; error: Error }> = []

    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 10,
      flushInterval: 1000,
      transform: (event: StreamEvent) => {
        if ((event.data as any)?.shouldFail) {
          throw new Error('Transform failed for event')
        }
        return event
      },
      // onTransformError doesn't exist yet - this tests that it should
      onTransformError: (event: StreamEvent, error: Error) => {
        transformErrors.push({ event, error })
      },
    } as StreamBridgeConfig)

    // Act - emit uses (operation, table, data) signature
    bridge.emit('insert', 'test', { value: 'ok' })
    bridge.emit('insert', 'test', { shouldFail: true }) // Will throw in transform
    bridge.emit('insert', 'test', { value: 'ok' })
    await bridge.flush()

    // Assert - CURRENTLY FAILS because onTransformError is not called
    expect(transformErrors.length).toBe(1)
    expect((transformErrors[0].event.data as any).shouldFail).toBe(true)
    expect(transformErrors[0].error.message).toContain('Transform failed')

    await bridge.close()
  })

  it('should log transform errors with event context', async () => {
    // Arrange
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 10,
      flushInterval: 1000,
      transform: () => {
        throw new Error('Transform explosion')
      },
    })

    // Act
    bridge.emit('insert', 'test', { x: 1 })
    await bridge.flush()

    // Assert - CURRENTLY FAILS because errors are silently swallowed
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('transform')

    consoleErrorSpy.mockRestore()
    await bridge.close()
  })

  it('should track transform failure count in metrics', async () => {
    // Arrange
    let failCount = 0
    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 10,
      flushInterval: 1000,
      transform: (event: StreamEvent) => {
        if ((event.data as any)?.fail) {
          failCount++ // For test reference
          throw new Error('Transform error')
        }
        return event
      },
    })

    // Act
    bridge.emit('insert', 'test', { fail: true })
    bridge.emit('insert', 'test', { fail: true })
    bridge.emit('insert', 'test', { fail: false })
    await bridge.flush()

    // Assert - CURRENTLY FAILS because no metrics tracking
    const metrics = (bridge as any).getMetrics?.() ?? {}
    expect(metrics.transformErrors ?? -1).toBe(2)

    await bridge.close()
  })
})

// ============================================================================
// TEST 4: STREAM-BRIDGE - CLOSE FLUSH ERROR HANDLING
// ============================================================================

/**
 * File: streaming/stream-bridge.ts
 * Line: 481
 *
 * Current behavior (BROKEN):
 *   } catch {
 *     // Best effort flush on close - don't throw
 *   }
 *
 * Expected behavior:
 * - Should call onCloseError callback if provided
 * - Should log flush errors on close with event count
 * - Should expose unflushed events for recovery
 */
describe('StreamBridge Close Flush Error Handling', () => {
  let mockPipeline: {
    send: ReturnType<typeof vi.fn>
    events: unknown[]
    setError: (err: Error | null) => void
  }

  beforeEach(() => {
    vi.useFakeTimers()
    const events: unknown[] = []
    let error: Error | null = null

    mockPipeline = {
      send: vi.fn(async (batch: unknown[]) => {
        if (error) throw error
        events.push(...batch)
      }),
      events,
      setError: (err: Error | null) => { error = err },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should call onCloseError callback when flush fails on close', async () => {
    // Arrange
    let closeError: Error | null = null
    let unflushedEvents: StreamEvent[] = []

    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 100, // Large batch so events stay buffered
      flushInterval: 60000,
      maxRetries: 1, // Fail fast
      // onCloseError doesn't exist yet - this tests that it should
      onCloseError: (error: Error, events: StreamEvent[]) => {
        closeError = error
        unflushedEvents = events
      },
    } as StreamBridgeConfig)

    // Add events to buffer - emit(operation, table, data)
    bridge.emit('insert', 'test', { a: 1 })
    bridge.emit('insert', 'test', { b: 2 })
    bridge.emit('insert', 'test', { c: 3 })

    // Make pipeline fail
    mockPipeline.setError(new Error('Pipeline connection lost'))

    // Act
    await bridge.close()

    // Assert - CURRENTLY FAILS because onCloseError is not called
    expect(closeError).not.toBeNull()
    expect(closeError?.message).toContain('Pipeline connection lost')
    expect(unflushedEvents.length).toBe(3)
  })

  it('should log close flush errors with buffered event count', async () => {
    // Arrange
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 100,
      flushInterval: 60000,
      maxRetries: 1,
    })

    // Buffer some events
    bridge.emit('insert', 'test', { x: 1 })
    bridge.emit('insert', 'test', { x: 2 })

    // Make flush fail
    mockPipeline.setError(new Error('Network error'))

    // Act
    await bridge.close()

    // Assert - CURRENTLY FAILS because error is silently swallowed
    expect(consoleErrorSpy).toHaveBeenCalled()
    const logMessage = consoleErrorSpy.mock.calls[0]?.join(' ') ?? ''
    expect(logMessage).toContain('close')
    expect(logMessage).toContain('2') // Event count

    consoleErrorSpy.mockRestore()
  })

  it('should expose unflushed events for recovery after close error', async () => {
    // Arrange
    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 100,
      flushInterval: 60000,
      maxRetries: 1,
    })

    // Buffer events
    bridge.emit('insert', 'test', { important: true, id: 'event-1' })
    bridge.emit('insert', 'test', { important: true, id: 'event-2' })

    // Make flush fail
    mockPipeline.setError(new Error('Storage unavailable'))

    // Act
    await bridge.close()

    // Assert - CURRENTLY FAILS because unflushed events are not exposed
    const unflushed = (bridge as any).getUnflushedEvents?.() ?? []
    expect(unflushed.length).toBe(2)
    expect((unflushed[0].data as any).id).toBe('event-1')
    expect((unflushed[1].data as any).id).toBe('event-2')
  })

  it('should not lose events silently when close flush fails', async () => {
    // This is the critical data loss scenario
    // Arrange
    const bridge = new StreamBridge(mockPipeline as any, {
      batchSize: 100,
      flushInterval: 60000,
      maxRetries: 1,
    })

    // Add important events
    for (let i = 0; i < 10; i++) {
      bridge.emit('insert', 'test', { sequence: i })
    }

    // Simulate connection loss
    mockPipeline.setError(new Error('Connection reset'))

    // Act
    await bridge.close()

    // Assert - CURRENTLY FAILS
    // The current implementation silently loses these 10 events
    // Expected: Some mechanism to recover or report lost events
    expect(mockPipeline.events.length).toBe(0) // Nothing was sent

    // At minimum, we should know events were lost
    const closeResult = (bridge as any).closeResult ?? {}
    expect(closeResult.eventsLost ?? -1).toBe(10)
  })
})
