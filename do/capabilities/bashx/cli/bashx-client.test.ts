/**
 * Tests for BashxClient - Bun-native CLI client
 *
 * Uses mock WebSocket to test client behavior without real server connection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BashxClient, type BashxClientOptions, type CommandResult, type StreamChunk } from './bashx-client'

// Mock WebSocket for testing
class MockWebSocket {
  static instances: MockWebSocket[] = []

  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0 // CONNECTING

  private messageQueue: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)

    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1 // OPEN
      this.onopen?.()

      // Send session message
      this.simulateServerMessage({
        type: 'session',
        sessionId: 'mock-session-123'
      })
    }, 0)
  }

  send(data: string): void {
    this.messageQueue.push(data)
  }

  close(): void {
    this.readyState = 3 // CLOSED
    this.onclose?.()
  }

  // Test helper: get sent messages
  getSentMessages(): object[] {
    return this.messageQueue.map(m => JSON.parse(m))
  }

  // Test helper: simulate server response
  simulateServerMessage(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  // Test helper: simulate server error
  simulateError(): void {
    this.onerror?.({})
  }

  static reset(): void {
    MockWebSocket.instances = []
  }

  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }
}

// Install mock WebSocket globally
const originalWebSocket = globalThis.WebSocket
beforeEach(() => {
  MockWebSocket.reset()
  ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  ;(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket
})

describe('BashxClient', () => {
  describe('constructor', () => {
    it('should create client with default options', () => {
      const client = new BashxClient()
      expect(client.isConnected).toBe(false)
      expect(client.getSessionId()).toBeNull()
    })

    it('should accept custom options', () => {
      const options: BashxClientOptions = {
        url: 'wss://custom.bashx.do/ws',
        sessionId: 'existing-session',
        reconnect: false,
        reconnectDelay: 2000,
        maxReconnectAttempts: 10
      }
      const client = new BashxClient(options)
      expect(client.isConnected).toBe(false)
    })
  })

  describe('connect', () => {
    it('should connect to default URL', async () => {
      const client = new BashxClient()
      await client.connect()

      expect(client.isConnected).toBe(true)
      const ws = MockWebSocket.getLastInstance()
      expect(ws?.url).toBe('wss://bashx.do/ws')
    })

    it('should connect to custom URL', async () => {
      const client = new BashxClient()
      await client.connect('wss://custom.server/ws')

      expect(client.isConnected).toBe(true)
      const ws = MockWebSocket.getLastInstance()
      expect(ws?.url).toBe('wss://custom.server/ws')
    })

    it('should use session ID from options', async () => {
      const client = new BashxClient({ sessionId: 'my-session' })
      await client.connect()

      const ws = MockWebSocket.getLastInstance()
      expect(ws?.url).toBe('wss://bashx.do/ws?session=my-session')
    })

    it('should receive session ID from server', async () => {
      const client = new BashxClient()
      await client.connect()

      // Wait for session message
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(client.getSessionId()).toBe('mock-session-123')
    })

    it('should call onConnect handler', async () => {
      const client = new BashxClient()
      const onConnect = vi.fn()
      client.onConnect(onConnect)

      await client.connect()
      expect(onConnect).toHaveBeenCalled()
    })

    it('should reject on connection error', async () => {
      // Override mock to simulate error
      ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = class ErrorWebSocket {
        onopen: (() => void) | null = null
        onclose: (() => void) | null = null
        onerror: ((event: unknown) => void) | null = null
        onmessage: ((event: { data: string }) => void) | null = null

        constructor() {
          setTimeout(() => {
            this.onerror?.({})
          }, 0)
        }
        close(): void { /* noop */ }
      }

      const client = new BashxClient({ reconnect: false })
      await expect(client.connect()).rejects.toThrow('WebSocket error')
    })
  })

  describe('execute', () => {
    it('should throw if not connected', async () => {
      const client = new BashxClient()
      await expect(client.execute('ls')).rejects.toThrow('Not connected')
    })

    it('should send execute command', async () => {
      const client = new BashxClient()
      await client.connect()

      const ws = MockWebSocket.getLastInstance()!

      // Start execution (don't await - we need to send response)
      const resultPromise = client.execute('ls -la')

      // Wait for message to be sent
      await new Promise(resolve => setTimeout(resolve, 10))

      const messages = ws.getSentMessages()
      const execMessage = messages.find(m => (m as { type: string }).type === 'execute')
      expect(execMessage).toBeDefined()
      expect((execMessage as { command: string }).command).toBe('ls -la')
      expect((execMessage as { requestId: string }).requestId).toBeDefined()

      // Simulate server response
      const requestId = (execMessage as { requestId: string }).requestId
      ws.simulateServerMessage({
        type: 'stdout',
        requestId,
        data: 'file1.txt\nfile2.txt\n'
      })
      ws.simulateServerMessage({
        type: 'exit',
        requestId,
        exitCode: 0
      })

      const result = await resultPromise
      expect(result.stdout).toBe('file1.txt\nfile2.txt\n')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should handle stderr output', async () => {
      const client = new BashxClient()
      await client.connect()

      const ws = MockWebSocket.getLastInstance()!
      const resultPromise = client.execute('cat nonexistent')

      await new Promise(resolve => setTimeout(resolve, 10))
      const messages = ws.getSentMessages()
      const execMessage = messages.find(m => (m as { type: string }).type === 'execute')!
      const requestId = (execMessage as { requestId: string }).requestId

      ws.simulateServerMessage({
        type: 'stderr',
        requestId,
        data: 'cat: nonexistent: No such file or directory\n'
      })
      ws.simulateServerMessage({
        type: 'exit',
        requestId,
        exitCode: 1
      })

      const result = await resultPromise
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('cat: nonexistent: No such file or directory\n')
      expect(result.exitCode).toBe(1)
    })

    it('should handle error response', async () => {
      const client = new BashxClient()
      await client.connect()

      const ws = MockWebSocket.getLastInstance()!
      const resultPromise = client.execute('bad command')

      await new Promise(resolve => setTimeout(resolve, 10))
      const messages = ws.getSentMessages()
      const execMessage = messages.find(m => (m as { type: string }).type === 'execute')!
      const requestId = (execMessage as { requestId: string }).requestId

      ws.simulateServerMessage({
        type: 'error',
        requestId,
        error: 'Command blocked by safety gate'
      })

      await expect(resultPromise).rejects.toThrow('Command blocked by safety gate')
    })
  })

  describe('stream', () => {
    it('should throw if not connected', async () => {
      const client = new BashxClient()
      const generator = client.stream('ls')
      await expect(generator.next()).rejects.toThrow('Not connected')
    })

    it('should yield chunks as they arrive', async () => {
      const client = new BashxClient()
      await client.connect()

      const ws = MockWebSocket.getLastInstance()!
      const chunks: StreamChunk[] = []

      // Start streaming
      const generator = client.stream('long-running-command')

      // Get first chunk request
      const firstChunkPromise = generator.next()

      await new Promise(resolve => setTimeout(resolve, 10))
      const messages = ws.getSentMessages()
      const execMessage = messages.find(m => (m as { type: string }).type === 'execute')!
      const requestId = (execMessage as { requestId: string }).requestId
      expect((execMessage as { stream: boolean }).stream).toBe(true)

      // Send chunks
      ws.simulateServerMessage({
        type: 'stdout',
        requestId,
        data: 'line 1\n'
      })

      const firstResult = await firstChunkPromise
      expect(firstResult.value).toEqual({ type: 'stdout', data: 'line 1\n' })

      // Send more chunks
      ws.simulateServerMessage({
        type: 'stdout',
        requestId,
        data: 'line 2\n'
      })
      ws.simulateServerMessage({
        type: 'exit',
        requestId,
        exitCode: 0
      })

      // Collect remaining chunks
      for await (const chunk of { [Symbol.asyncIterator]: () => generator }) {
        chunks.push(chunk)
      }

      expect(chunks).toContainEqual({ type: 'stdout', data: 'line 2\n' })
      expect(chunks).toContainEqual({ type: 'exit', exitCode: 0 })
    })
  })

  describe('disconnect', () => {
    it('should close WebSocket connection', async () => {
      const client = new BashxClient()
      await client.connect()

      expect(client.isConnected).toBe(true)
      client.disconnect()
      expect(client.isConnected).toBe(false)
    })

    it('should call onDisconnect handler', async () => {
      const client = new BashxClient()
      const onDisconnect = vi.fn()
      client.onDisconnect(onDisconnect)

      await client.connect()
      client.disconnect()

      expect(onDisconnect).toHaveBeenCalled()
    })

    it('should reject pending requests', async () => {
      const client = new BashxClient()
      await client.connect()

      const resultPromise = client.execute('slow command')

      // Wait for command to be sent
      await new Promise(resolve => setTimeout(resolve, 10))

      // Disconnect before response
      client.disconnect()

      await expect(resultPromise).rejects.toThrow('Disconnected')
    })

    it('should clear session ID', async () => {
      const client = new BashxClient()
      await client.connect()
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(client.getSessionId()).toBe('mock-session-123')
      client.disconnect()
      expect(client.getSessionId()).toBeNull()
    })
  })

  describe('reconnection', () => {
    it('should attempt reconnection when enabled', async () => {
      const client = new BashxClient({
        reconnect: true,
        reconnectDelay: 50,
        maxReconnectAttempts: 2
      })

      await client.connect()
      const initialWs = MockWebSocket.getLastInstance()!

      // Simulate connection close
      initialWs.close()

      // Wait for reconnection attempt
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should have attempted reconnection
      expect(MockWebSocket.instances.length).toBeGreaterThan(1)
    })

    it('should not reconnect when disabled', async () => {
      const client = new BashxClient({
        reconnect: false
      })

      await client.connect()
      const initialInstanceCount = MockWebSocket.instances.length

      // Simulate connection close
      MockWebSocket.getLastInstance()!.close()

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not have reconnected
      expect(MockWebSocket.instances.length).toBe(initialInstanceCount)
    })
  })

  describe('event handlers', () => {
    it('should call onError handler', async () => {
      const client = new BashxClient()
      const onError = vi.fn()
      client.onError(onError)

      await client.connect()
      const ws = MockWebSocket.getLastInstance()!

      ws.simulateError()

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('raw mode', () => {
    it('should report raw mode status', () => {
      const client = new BashxClient()
      expect(client.isRawMode()).toBe(false)
    })

    // Note: Raw mode tests are limited because they depend on TTY
    // which is not available in test environment
    it('should handle enableRawMode when not a TTY', () => {
      const client = new BashxClient()
      // In test environment, stdin is not a TTY
      const result = client.enableRawMode()
      expect(typeof result).toBe('boolean')
    })
  })
})

describe('BashxClient integration scenarios', () => {
  it('should handle multiple concurrent commands', async () => {
    const client = new BashxClient()
    await client.connect()

    const ws = MockWebSocket.getLastInstance()!

    // Start multiple commands
    const promise1 = client.execute('cmd1')
    const promise2 = client.execute('cmd2')
    const promise3 = client.execute('cmd3')

    await new Promise(resolve => setTimeout(resolve, 10))

    // Get all request IDs
    const messages = ws.getSentMessages()
    const execMessages = messages.filter(m => (m as { type: string }).type === 'execute')
    expect(execMessages.length).toBe(3)

    // Respond to all (in different order)
    const requestIds = execMessages.map(m => (m as { requestId: string }).requestId)

    ws.simulateServerMessage({ type: 'stdout', requestId: requestIds[2], data: 'output3' })
    ws.simulateServerMessage({ type: 'exit', requestId: requestIds[2], exitCode: 0 })

    ws.simulateServerMessage({ type: 'stdout', requestId: requestIds[0], data: 'output1' })
    ws.simulateServerMessage({ type: 'exit', requestId: requestIds[0], exitCode: 0 })

    ws.simulateServerMessage({ type: 'stdout', requestId: requestIds[1], data: 'output2' })
    ws.simulateServerMessage({ type: 'exit', requestId: requestIds[1], exitCode: 0 })

    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

    expect(result1.stdout).toBe('output1')
    expect(result2.stdout).toBe('output2')
    expect(result3.stdout).toBe('output3')
  })

  it('should handle interleaved stdout and stderr', async () => {
    const client = new BashxClient()
    await client.connect()

    const ws = MockWebSocket.getLastInstance()!
    const resultPromise = client.execute('mixed output command')

    await new Promise(resolve => setTimeout(resolve, 10))
    const execMessage = ws.getSentMessages().find(m => (m as { type: string }).type === 'execute')!
    const requestId = (execMessage as { requestId: string }).requestId

    // Interleaved output
    ws.simulateServerMessage({ type: 'stdout', requestId, data: 'out1\n' })
    ws.simulateServerMessage({ type: 'stderr', requestId, data: 'err1\n' })
    ws.simulateServerMessage({ type: 'stdout', requestId, data: 'out2\n' })
    ws.simulateServerMessage({ type: 'stderr', requestId, data: 'err2\n' })
    ws.simulateServerMessage({ type: 'exit', requestId, exitCode: 0 })

    const result = await resultPromise
    expect(result.stdout).toBe('out1\nout2\n')
    expect(result.stderr).toBe('err1\nerr2\n')
  })
})
