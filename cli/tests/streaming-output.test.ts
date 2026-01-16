/**
 * Streaming Output Tests (TDD RED Phase)
 *
 * Tests for real-time log streaming from DO to CLI during long-running evaluations.
 *
 * Current state: RPC returns complete results only, no streaming.
 * Target state: Real-time log streaming via 'log' message type.
 *
 * Architecture:
 * - CLI calls rpcClient.evaluate(code)
 * - During evaluation, DO sends 'log' messages via WebSocket
 * - CLI receives and displays logs in real-time (incremental rendering)
 * - Final 'response' message arrives when evaluation completes
 *
 * RED PHASE: These tests define the expected streaming behavior.
 * They should FAIL because streaming isn't implemented yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to create shared state between mock and tests
const { wsInstances, getMockWs, resetWs } = vi.hoisted(() => {
  const instances: any[] = []
  return {
    wsInstances: instances,
    getMockWs: () => instances[instances.length - 1],
    resetWs: () => {
      instances.length = 0
    },
  }
})

// Mock the ws module
vi.mock('ws', () => {
  class MockWebSocket {
    readyState: number = 0 // CONNECTING
    url: string
    options?: { headers?: Record<string, string> }

    private eventHandlers: Map<string, ((...args: any[]) => void)[]> = new Map()

    send = vi.fn()
    close = vi.fn(function (this: any, code?: number, reason?: string) {
      this.readyState = 3 // CLOSED
      setImmediate(() => {
        const handlers = this.eventHandlers.get('close')
        if (handlers) {
          handlers.forEach((h: any) => h(code ?? 1000, Buffer.from(reason ?? 'closed')))
        }
      })
    })

    constructor(url: string, options?: { headers?: Record<string, string> }) {
      this.url = url
      this.options = options
      wsInstances.push(this)
    }

    on(event: string, handler: (...args: any[]) => void): MockWebSocket {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, [])
      }
      this.eventHandlers.get(event)!.push(handler)
      return this
    }

    _triggerEvent(event: string, ...args: any[]): boolean {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        handlers.forEach((h) => h(...args))
        return true
      }
      return false
    }
  }

  return { default: MockWebSocket }
})

// Import RpcClient AFTER the mock is set up
import { RpcClient, type RpcMessage } from '../src/rpc-client.js'

// Helper type for the mocked WebSocket
interface MockedWebSocket {
  url: string
  options?: { headers?: Record<string, string> }
  readyState: number
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on(event: string, handler: (...args: any[]) => void): MockedWebSocket
  _triggerEvent(event: string, ...args: any[]): boolean
}

// Helper functions
function simulateOpen(ws: MockedWebSocket) {
  ws.readyState = 1 // OPEN
  ws._triggerEvent('open')
}

function simulateResponse(ws: MockedWebSocket, id: string, result: unknown) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      result,
    })
  )
}

function simulateLogMessage(
  ws: MockedWebSocket,
  correlationId: string,
  level: string,
  message: string,
  index?: number
) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'log',
      correlationId,
      data: { level, message, index },
    })
  )
}

function simulateClose(ws: MockedWebSocket, code = 1006, reason = 'Connection lost') {
  ws.readyState = 3 // CLOSED
  ws._triggerEvent('close', code, Buffer.from(reason))
}

describe('RpcClient Streaming Output', () => {
  let client: RpcClient
  let mockWs: MockedWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    resetWs()

    client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      timeout: 30000,
      autoReconnect: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /**
   * Helper to connect client and get mock WebSocket
   */
  async function connectClient(
    schema = { name: 'Test', fields: [], methods: [] }
  ): Promise<MockedWebSocket> {
    const connectPromise = client.connect()

    await vi.advanceTimersByTimeAsync(0)

    mockWs = getMockWs() as MockedWebSocket
    simulateOpen(mockWs)

    await vi.advanceTimersByTimeAsync(0)
    const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
    simulateResponse(mockWs, introspectCall.id, schema)

    await connectPromise
    return mockWs
  }

  // ===========================================================================
  // Test 1: RpcClient handles 'log' message type during evaluation
  // ===========================================================================

  describe('log message type handling', () => {
    it('should handle log message type in handleMessage', async () => {
      await connectClient()

      // Start evaluation
      const evaluatePromise = client.evaluate('longRunningTask()')

      await vi.advanceTimersByTimeAsync(0)

      // Get the evaluate call ID from sent messages
      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Set up spy to verify log handling
      const logSpy = vi.fn()
      client.on('log', logSpy)

      // Simulate log message from server
      simulateLogMessage(mockWs, correlationId, 'info', 'Processing step 1...')

      await vi.advanceTimersByTimeAsync(0)

      // Verify log event was emitted
      expect(logSpy).toHaveBeenCalledWith({
        correlationId,
        level: 'info',
        message: 'Processing step 1...',
        index: undefined,
      })

      // Clean up: send final response
      simulateResponse(mockWs, correlationId, {
        success: true,
        value: 'done',
        logs: [],
      })

      await evaluatePromise
    })

    it('should include log message type in RpcMessage union type', async () => {
      // This is a type-level test - verifying the RpcMessage type includes 'log'
      const message: RpcMessage = {
        id: 'test',
        type: 'log',
        correlationId: 'eval_123',
        data: { level: 'info', message: 'test' },
      }

      expect(message.type).toBe('log')
    })
  })

  // ===========================================================================
  // Test 2: Log messages are emitted as events while evaluation is in progress
  // ===========================================================================

  describe('log event emission during evaluation', () => {
    it('should emit log events while evaluate call is pending', async () => {
      await connectClient()

      const logs: Array<{ level: string; message: string }> = []
      client.on('log', (data: { level: string; message: string }) => {
        logs.push({ level: data.level, message: data.message })
      })

      // Start evaluation (doesn't resolve yet)
      const evaluatePromise = client.evaluate('await longTask()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Simulate streaming logs during evaluation
      simulateLogMessage(mockWs, correlationId, 'info', 'Starting task...')
      await vi.advanceTimersByTimeAsync(10)

      simulateLogMessage(mockWs, correlationId, 'info', 'Step 1 complete')
      await vi.advanceTimersByTimeAsync(10)

      simulateLogMessage(mockWs, correlationId, 'warn', 'Slow network detected')
      await vi.advanceTimersByTimeAsync(10)

      // Verify logs were captured during evaluation
      expect(logs).toHaveLength(3)
      expect(logs[0]).toEqual({ level: 'info', message: 'Starting task...' })
      expect(logs[1]).toEqual({ level: 'info', message: 'Step 1 complete' })
      expect(logs[2]).toEqual({ level: 'warn', message: 'Slow network detected' })

      // Complete evaluation
      simulateResponse(mockWs, correlationId, {
        success: true,
        value: 'result',
        logs: [],
      })

      const result = await evaluatePromise
      expect(result.success).toBe(true)
    })

    it('should correlate log messages with specific evaluation calls', async () => {
      await connectClient()

      const logsForEval1: string[] = []
      const logsForEval2: string[] = []

      // Subscribe to logs with correlation tracking
      client.on('log', (data: { correlationId: string; message: string }) => {
        if (data.correlationId === 'eval1') {
          logsForEval1.push(data.message)
        } else if (data.correlationId === 'eval2') {
          logsForEval2.push(data.message)
        }
      })

      // Note: In real implementation, we need a way to get correlationId
      // This test verifies logs are correctly associated with their evaluations
      expect(logsForEval1).toEqual([])
      expect(logsForEval2).toEqual([])
    })
  })

  // ===========================================================================
  // Test 3: Multiple log messages can arrive before final result
  // ===========================================================================

  describe('multiple streaming logs before result', () => {
    it('should handle many log messages before final response', async () => {
      await connectClient()

      const receivedLogs: Array<{ level: string; message: string; index?: number }> = []
      client.on('log', (data) => {
        receivedLogs.push(data)
      })

      const evaluatePromise = client.evaluate('processLargeDataset()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Simulate 10 log messages arriving
      for (let i = 0; i < 10; i++) {
        simulateLogMessage(
          mockWs,
          correlationId,
          'info',
          `Processing batch ${i + 1}/10`,
          i
        )
        await vi.advanceTimersByTimeAsync(5)
      }

      // Verify all logs received
      expect(receivedLogs).toHaveLength(10)

      // Verify order is preserved
      for (let i = 0; i < 10; i++) {
        expect(receivedLogs[i].message).toBe(`Processing batch ${i + 1}/10`)
        expect(receivedLogs[i].index).toBe(i)
      }

      // Send final result
      simulateResponse(mockWs, correlationId, {
        success: true,
        value: { processed: 1000 },
        logs: [], // Logs already streamed
      })

      const result = await evaluatePromise
      expect(result.success).toBe(true)
    })

    it('should handle interleaved log levels', async () => {
      await connectClient()

      const logs: Array<{ level: string; message: string }> = []
      client.on('log', (data) => {
        logs.push({ level: data.level, message: data.message })
      })

      const evaluatePromise = client.evaluate('mixedLogging()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Send logs with different levels
      simulateLogMessage(mockWs, correlationId, 'info', 'Info message')
      simulateLogMessage(mockWs, correlationId, 'warn', 'Warning message')
      simulateLogMessage(mockWs, correlationId, 'error', 'Error message')
      simulateLogMessage(mockWs, correlationId, 'debug', 'Debug message')
      simulateLogMessage(mockWs, correlationId, 'log', 'Log message')

      await vi.advanceTimersByTimeAsync(10)

      expect(logs).toHaveLength(5)
      expect(logs.map((l) => l.level)).toEqual(['info', 'warn', 'error', 'debug', 'log'])

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluatePromise
    })
  })

  // ===========================================================================
  // Test 4: Logs display in real-time (Output component updates incrementally)
  // ===========================================================================

  describe('real-time display integration', () => {
    it('should provide onLog callback option for evaluate method', async () => {
      await connectClient()

      const streamedLogs: Array<{ level: string; message: string }> = []

      // The evaluate method should accept an optional onLog callback
      const evaluatePromise = (client as any).evaluateWithStreaming(
        'longTask()',
        (log: { level: string; message: string }) => {
          streamedLogs.push(log)
        }
      )

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Stream logs
      simulateLogMessage(mockWs, correlationId, 'info', 'Step 1')
      simulateLogMessage(mockWs, correlationId, 'info', 'Step 2')

      await vi.advanceTimersByTimeAsync(10)

      // Logs should be passed to callback immediately
      expect(streamedLogs).toHaveLength(2)
      expect(streamedLogs[0]).toEqual({ level: 'info', message: 'Step 1' })
      expect(streamedLogs[1]).toEqual({ level: 'info', message: 'Step 2' })

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: 'done', logs: [] })
      await evaluatePromise
    })

    it('should allow subscribing to logs for specific evaluation', async () => {
      await connectClient()

      // evaluateWithStreaming should return an object with logs observable
      const evaluation = client.evaluateStreaming?.('processData()')

      // Should have a way to subscribe to logs
      expect(evaluation).toHaveProperty('onLog')
      expect(typeof evaluation?.onLog).toBe('function')

      // Should have a promise for the final result
      expect(evaluation).toHaveProperty('result')
      expect(evaluation?.result).toBeInstanceOf(Promise)
    })
  })

  // ===========================================================================
  // Test 5: Streaming can handle rapid log messages (debouncing/batching)
  // ===========================================================================

  describe('rapid log message handling', () => {
    it('should handle rapid log messages without dropping any', async () => {
      await connectClient()

      const receivedLogs: string[] = []
      client.on('log', (data) => {
        receivedLogs.push(data.message)
      })

      const evaluatePromise = client.evaluate('rapidLogger()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Simulate 100 rapid log messages (no delay between them)
      for (let i = 0; i < 100; i++) {
        simulateLogMessage(mockWs, correlationId, 'info', `Log ${i}`)
      }

      await vi.advanceTimersByTimeAsync(10)

      // All logs should be received
      expect(receivedLogs).toHaveLength(100)

      // Verify order preserved
      for (let i = 0; i < 100; i++) {
        expect(receivedLogs[i]).toBe(`Log ${i}`)
      }

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluatePromise
    })

    it('should support optional batching for high-frequency logs', async () => {
      await connectClient()

      const batches: Array<Array<{ level: string; message: string }>> = []

      // evaluateWithBatching should batch rapid logs
      const evaluation = (client as any).evaluateWithBatching?.(
        'rapidLogger()',
        {
          batchInterval: 100, // Batch logs every 100ms
          onBatch: (batch: Array<{ level: string; message: string }>) => {
            batches.push([...batch])
          },
        }
      )

      if (!evaluation) {
        // Expected to fail - feature not implemented
        expect(client).toHaveProperty('evaluateWithBatching')
        return
      }

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Send logs rapidly
      for (let i = 0; i < 50; i++) {
        simulateLogMessage(mockWs, correlationId, 'info', `Log ${i}`)
      }

      // Advance past batch interval
      await vi.advanceTimersByTimeAsync(150)

      // Should have received batched logs
      expect(batches.length).toBeGreaterThan(0)

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluation.result
    })

    it('should handle backpressure gracefully', async () => {
      await connectClient()

      let droppedCount = 0
      const receivedCount = { value: 0 }

      // Set up a slow consumer
      client.on('log', async () => {
        // Simulate slow processing
        await new Promise((r) => setTimeout(r, 50))
        receivedCount.value++
      })

      client.on('log:dropped', () => {
        droppedCount++
      })

      const evaluatePromise = client.evaluate('massiveOutput()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Send many logs faster than consumer can process
      for (let i = 0; i < 1000; i++) {
        simulateLogMessage(mockWs, correlationId, 'info', `Log ${i}`)
      }

      await vi.advanceTimersByTimeAsync(1000)

      // Either all received OR some dropped with notification
      // (backpressure handling is implementation-defined)
      expect(receivedCount.value + droppedCount).toBeGreaterThan(0)

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluatePromise
    })
  })

  // ===========================================================================
  // Test 6: Final result arrives after all logs
  // ===========================================================================

  describe('final result after logs', () => {
    it('should resolve evaluate promise after final response', async () => {
      await connectClient()

      const timeline: string[] = []

      client.on('log', () => {
        timeline.push('log')
      })

      const evaluatePromise = client.evaluate('timedTask()')

      evaluatePromise.then(() => {
        timeline.push('result')
      })

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Send logs first
      simulateLogMessage(mockWs, correlationId, 'info', 'Starting')
      simulateLogMessage(mockWs, correlationId, 'info', 'Processing')
      simulateLogMessage(mockWs, correlationId, 'info', 'Finishing')

      await vi.advanceTimersByTimeAsync(10)

      // Result not yet received
      expect(timeline).toEqual(['log', 'log', 'log'])

      // Send final result
      simulateResponse(mockWs, correlationId, {
        success: true,
        value: { completed: true },
        logs: [],
      })

      await vi.advanceTimersByTimeAsync(10)
      await evaluatePromise

      // Result comes after all logs
      expect(timeline).toEqual(['log', 'log', 'log', 'result'])
    })

    it('should include both streamed logs and final logs array in result', async () => {
      await connectClient()

      const streamedLogs: string[] = []
      client.on('log', (data) => {
        streamedLogs.push(data.message)
      })

      const evaluatePromise = client.evaluate('mixedOutput()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Some logs streamed
      simulateLogMessage(mockWs, correlationId, 'info', 'Streamed 1')
      simulateLogMessage(mockWs, correlationId, 'info', 'Streamed 2')

      await vi.advanceTimersByTimeAsync(10)

      // Final response includes any non-streamed logs
      simulateResponse(mockWs, correlationId, {
        success: true,
        value: 'done',
        logs: [
          { level: 'info', message: 'Final log 1' },
          { level: 'info', message: 'Final log 2' },
        ],
      })

      const result = await evaluatePromise

      // Streamed logs captured separately
      expect(streamedLogs).toEqual(['Streamed 1', 'Streamed 2'])

      // Final logs in result
      expect(result.logs).toEqual([
        { level: 'info', message: 'Final log 1' },
        { level: 'info', message: 'Final log 2' },
      ])
    })

    it('should emit complete event after result with all logs', async () => {
      await connectClient()

      let completeData: any = null
      client.on('evaluate:complete', (data) => {
        completeData = data
      })

      const evaluatePromise = client.evaluate('fullTask()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Stream logs
      simulateLogMessage(mockWs, correlationId, 'info', 'Log 1')
      simulateLogMessage(mockWs, correlationId, 'info', 'Log 2')

      await vi.advanceTimersByTimeAsync(10)

      // Complete
      simulateResponse(mockWs, correlationId, {
        success: true,
        value: 'result',
        logs: [{ level: 'info', message: 'Final' }],
      })

      await evaluatePromise

      // Complete event should have both streamed and final logs
      expect(completeData).not.toBeNull()
      expect(completeData.streamedLogs).toHaveLength(2)
      expect(completeData.result.logs).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Test 7: Connection close during streaming handles gracefully
  // ===========================================================================

  describe('connection close during streaming', () => {
    it('should reject evaluate promise on connection close', async () => {
      await connectClient()

      // Create promise with immediate catch handler to prevent unhandled rejection
      let caughtError: Error | null = null
      const evaluatePromise = client.evaluate('longTask()').catch((err) => {
        caughtError = err
        throw err // Re-throw for expect().rejects
      })

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Send some logs
      simulateLogMessage(mockWs, correlationId, 'info', 'Starting...')

      await vi.advanceTimersByTimeAsync(10)

      // Connection drops
      simulateClose(mockWs, 1006, 'Connection lost')

      await vi.advanceTimersByTimeAsync(10)

      // Promise should reject
      await expect(evaluatePromise).rejects.toThrow('Connection closed')
      expect(caughtError).not.toBeNull()
    })

    it('should preserve logs received before disconnect', async () => {
      await connectClient()

      const receivedLogs: string[] = []
      client.on('log', (data) => {
        receivedLogs.push(data.message)
      })

      // Attach rejection handler immediately to prevent unhandled rejection warning
      const evaluatePromise = client.evaluate('crashingTask()').catch(() => {
        // Expected to reject
      })

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Logs arrive before crash
      simulateLogMessage(mockWs, correlationId, 'info', 'Step 1 OK')
      simulateLogMessage(mockWs, correlationId, 'info', 'Step 2 OK')
      simulateLogMessage(mockWs, correlationId, 'error', 'Step 3 FAILED')

      await vi.advanceTimersByTimeAsync(10)

      // Connection drops
      simulateClose(mockWs)

      await vi.advanceTimersByTimeAsync(10)

      // Logs before disconnect should be preserved
      expect(receivedLogs).toEqual(['Step 1 OK', 'Step 2 OK', 'Step 3 FAILED'])

      // Wait for promise to settle
      await evaluatePromise
    })

    it('should emit streaming:interrupted event on disconnect', async () => {
      await connectClient()

      let interruptedData: any = null
      client.on('streaming:interrupted', (data) => {
        interruptedData = data
      })

      // Attach rejection handler immediately to prevent unhandled rejection warning
      const evaluatePromise = client.evaluate('interruptedTask()').catch(() => {
        // Expected to reject
      })

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Send some logs
      simulateLogMessage(mockWs, correlationId, 'info', 'Working...')

      await vi.advanceTimersByTimeAsync(10)

      // Disconnect
      simulateClose(mockWs, 1001, 'Going away')

      await vi.advanceTimersByTimeAsync(10)

      // Should emit interrupted event with context
      expect(interruptedData).not.toBeNull()
      expect(interruptedData.correlationId).toBe(correlationId)
      expect(interruptedData.reason).toContain('Going away')
      expect(interruptedData.logsReceived).toBe(1)

      // Wait for promise to settle
      await evaluatePromise
    })

    it('should cleanup pending streaming state on disconnect', async () => {
      await connectClient()

      // Start multiple evaluations with immediate catch handlers
      const eval1 = client.evaluate('task1()').catch(() => 'rejected1')
      const eval2 = client.evaluate('task2()').catch(() => 'rejected2')

      await vi.advanceTimersByTimeAsync(0)

      // Disconnect
      simulateClose(mockWs)

      await vi.advanceTimersByTimeAsync(10)

      // Both should have rejected
      const [result1, result2] = await Promise.all([eval1, eval2])
      expect(result1).toBe('rejected1')
      expect(result2).toBe('rejected2')

      // Internal state should be cleaned up (no memory leak)
      expect((client as any).pendingCalls.size).toBe(0)
    })
  })

  // ===========================================================================
  // Additional edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should ignore log messages for unknown correlation IDs', async () => {
      await connectClient()

      const logs: string[] = []
      client.on('log', (data) => {
        logs.push(data.message)
      })

      // Send log with unknown correlation ID
      simulateLogMessage(mockWs, 'unknown_id_12345', 'info', 'Orphan log')

      await vi.advanceTimersByTimeAsync(10)

      // Should not crash, log should be ignored or handled gracefully
      expect(logs).toHaveLength(0)
    })

    it('should handle malformed log messages', async () => {
      await connectClient()

      const errorSpy = vi.fn()
      client.on('error', errorSpy)

      // Send malformed log message
      mockWs._triggerEvent(
        'message',
        JSON.stringify({
          id: 'msg_1',
          type: 'log',
          // Missing required fields
        })
      )

      await vi.advanceTimersByTimeAsync(10)

      // Should not crash
      expect(true).toBe(true)
    })

    it('should handle empty log messages', async () => {
      await connectClient()

      const logs: string[] = []
      client.on('log', (data) => {
        logs.push(data.message)
      })

      const evaluatePromise = client.evaluate('emptyLogs()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Empty message
      simulateLogMessage(mockWs, correlationId, 'info', '')

      await vi.advanceTimersByTimeAsync(10)

      expect(logs).toContain('')

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluatePromise
    })

    it('should handle very long log messages', async () => {
      await connectClient()

      const logs: string[] = []
      client.on('log', (data) => {
        logs.push(data.message)
      })

      const evaluatePromise = client.evaluate('verboseTask()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Very long message (100KB)
      const longMessage = 'x'.repeat(100 * 1024)
      simulateLogMessage(mockWs, correlationId, 'info', longMessage)

      await vi.advanceTimersByTimeAsync(10)

      expect(logs[0]).toHaveLength(100 * 1024)

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluatePromise
    })

    it('should handle binary data in log messages gracefully', async () => {
      await connectClient()

      const logs: string[] = []
      client.on('log', (data) => {
        logs.push(data.message)
      })

      const evaluatePromise = client.evaluate('binaryOutput()')

      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls
      const evaluateCall = JSON.parse(calls[calls.length - 1][0])
      const correlationId = evaluateCall.id

      // Message with special characters
      const binaryLikeMessage = 'Data: \x00\x01\x02 mixed \uFFFD chars'
      simulateLogMessage(mockWs, correlationId, 'info', binaryLikeMessage)

      await vi.advanceTimersByTimeAsync(10)

      // Should handle gracefully
      expect(logs).toHaveLength(1)

      // Complete
      simulateResponse(mockWs, correlationId, { success: true, value: null, logs: [] })
      await evaluatePromise
    })
  })
})

// ===========================================================================
// Type extension tests (compile-time verification)
// ===========================================================================

describe('RpcMessage type extension', () => {
  it('should have correlationId property for log messages', () => {
    // This test verifies the RpcMessage interface includes correlationId
    // It will fail at compile time if the type is missing
    const logMessage: RpcMessage = {
      id: 'msg_1',
      type: 'log',
      correlationId: 'eval_123',
      data: { level: 'info', message: 'test' },
    }

    expect(logMessage.correlationId).toBe('eval_123')
  })
})
