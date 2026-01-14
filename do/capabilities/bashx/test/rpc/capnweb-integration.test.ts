/**
 * Cap'n Web RPC Integration Tests
 *
 * Tests for ShellApiRpcTarget and related Cap'n Web RPC integration.
 * Verifies that ShellApi can be exposed via RPC with pass-by-reference
 * semantics for ShellStream.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RpcTarget,
  ShellApiRpcTarget,
  ShellStreamRpcTarget,
  newWorkersRpcResponse,
  handleWebSocketRpc,
  createShellApiRpcTarget,
  asRpcTarget,
} from '../../src/rpc/capnweb-integration.js'
import { ShellApiImpl } from '../../src/rpc/shell-api-impl.js'
import { ShellStreamImpl } from '../../src/rpc/shell-stream-impl.js'
import type { RpcRequest, RpcResponse, RpcBatchResponse } from '../../src/rpc/capnweb-integration.js'

// ============================================================================
// RpcTarget Base Class Tests
// ============================================================================

describe('RpcTarget Base Class', () => {
  describe('Method Registration', () => {
    it('should allow registering custom methods', () => {
      const target = new RpcTarget()
      target['registerMethod']('customMethod', async () => 'result')
      expect(target.hasMethod('customMethod')).toBe(true)
    })

    it('should invoke registered methods', async () => {
      const target = new RpcTarget()
      target['registerMethod']('add', async (a: number, b: number) => a + b)
      const result = await target.invoke('add', [2, 3])
      expect(result).toBe(5)
    })

    it('should return false for unregistered methods', () => {
      const target = new RpcTarget()
      expect(target.hasMethod('unknownMethod')).toBe(false)
    })
  })

  describe('Security', () => {
    it('should block prototype methods', () => {
      const target = new RpcTarget()
      expect(target.hasMethod('constructor')).toBe(false)
      expect(target.hasMethod('__proto__')).toBe(false)
      expect(target.hasMethod('hasOwnProperty')).toBe(false)
    })

    it('should throw when invoking blocked methods', async () => {
      const target = new RpcTarget()
      await expect(target.invoke('constructor', [])).rejects.toThrow('Method not allowed')
      await expect(target.invoke('__proto__', [])).rejects.toThrow('Method not allowed')
    })

    it('should only allow methods in allowedMethods set', () => {
      class TestTarget extends RpcTarget {
        protected override allowedMethods = new Set(['safeMethod'])

        async safeMethod() {
          return 'safe'
        }

        async unsafeMethod() {
          return 'unsafe'
        }
      }

      const target = new TestTarget()
      expect(target.hasMethod('safeMethod')).toBe(true)
      expect(target.hasMethod('unsafeMethod')).toBe(false)
    })
  })
})

// ============================================================================
// ShellApiRpcTarget Tests
// ============================================================================

describe('ShellApiRpcTarget', () => {
  let target: ShellApiRpcTarget

  beforeEach(() => {
    target = new ShellApiRpcTarget()
  })

  afterEach(() => {
    if (Symbol.dispose in target) {
      target[Symbol.dispose]()
    }
  })

  describe('Method Registration', () => {
    it('should have exec method registered', () => {
      expect(target.hasMethod('exec')).toBe(true)
    })

    it('should have spawn method registered', () => {
      expect(target.hasMethod('spawn')).toBe(true)
    })

    it('should not expose internal methods', () => {
      expect(target.hasMethod('hasMethod')).toBe(false)
      expect(target.hasMethod('invoke')).toBe(false)
      expect(target.hasMethod('registerMethod')).toBe(false)
    })
  })

  describe('exec() via RPC', () => {
    it('should execute command and return ShellResult', async () => {
      const result = await target.invoke('exec', ['echo "hello"'])
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect((result as { stdout: string }).stdout).toContain('hello')
    })

    it('should accept options via invoke', async () => {
      const result = await target.invoke('exec', ['pwd', { cwd: '/tmp' }])
      const output = (result as { stdout: string }).stdout.trim()
      // On macOS, /tmp is symlinked to /private/tmp
      expect(['/tmp', '/private/tmp']).toContain(output)
    })

    it('should handle command failures', async () => {
      const result = await target.invoke('exec', ['exit 42'])
      expect((result as { exitCode: number }).exitCode).toBe(42)
    })
  })

  describe('spawn() via RPC', () => {
    it('should spawn process and return ShellStream', async () => {
      const stream = await target.invoke('spawn', ['cat']) as ShellStreamImpl

      expect(stream).toBeDefined()
      expect(stream.pid).toBeGreaterThan(0)
      expect(typeof stream.write).toBe('function')
      expect(typeof stream.kill).toBe('function')

      // Clean up
      stream.kill()
      await stream.wait()
    })

    it('should track spawned streams for cleanup', async () => {
      const stream = await target.invoke('spawn', ['cat']) as ShellStreamImpl

      // Dispose should clean up all streams
      target[Symbol.dispose]()

      // Stream should be killed
      const result = await stream.wait()
      // Exit code may be non-zero due to signal
      expect(result).toBeDefined()
    })
  })

  describe('dispose cleanup', () => {
    it('should clean up all tracked streams on dispose', async () => {
      const stream1 = await target.invoke('spawn', ['sleep 60']) as ShellStreamImpl
      const stream2 = await target.invoke('spawn', ['sleep 60']) as ShellStreamImpl

      // Both streams should be running
      expect(stream1.pid).toBeGreaterThan(0)
      expect(stream2.pid).toBeGreaterThan(0)

      // Dispose should kill both
      target[Symbol.dispose]()

      // Wait for both to exit
      const [result1, result2] = await Promise.all([stream1.wait(), stream2.wait()])

      // Both should have been killed
      expect(result1.signal).toBe('SIGTERM')
      expect(result2.signal).toBe('SIGTERM')
    })
  })
})

// ============================================================================
// ShellStreamRpcTarget Tests
// ============================================================================

describe('ShellStreamRpcTarget', () => {
  it('should wrap ShellStreamImpl with RpcTarget interface', async () => {
    const api = new ShellApiImpl()
    const rawStream = api.spawn('echo "test"') as ShellStreamImpl
    const target = new ShellStreamRpcTarget(rawStream)

    // Should have all methods registered
    expect(target.hasMethod('write')).toBe(true)
    expect(target.hasMethod('closeStdin')).toBe(true)
    expect(target.hasMethod('kill')).toBe(true)
    expect(target.hasMethod('onData')).toBe(true)
    expect(target.hasMethod('onStderr')).toBe(true)
    expect(target.hasMethod('onExit')).toBe(true)
    expect(target.hasMethod('wait')).toBe(true)

    await target.wait()
  })

  it('should expose pid property', async () => {
    const api = new ShellApiImpl()
    const rawStream = api.spawn('cat') as ShellStreamImpl
    const target = new ShellStreamRpcTarget(rawStream)

    expect(target.pid).toBe(rawStream.pid)
    expect(target.pid).toBeGreaterThan(0)

    target.kill()
    await target.wait()
  })

  it('should forward dispose to wrapped stream', async () => {
    const api = new ShellApiImpl()
    const rawStream = api.spawn('sleep 60') as ShellStreamImpl
    const target = new ShellStreamRpcTarget(rawStream)

    target[Symbol.dispose]()

    const result = await rawStream.wait()
    expect(result.signal).toBe('SIGTERM')
  })
})

// ============================================================================
// newWorkersRpcResponse Tests
// ============================================================================

describe('newWorkersRpcResponse', () => {
  class TestTarget extends RpcTarget {
    protected override allowedMethods = new Set(['echo', 'add', 'error'])

    async echo(msg: string) {
      return msg
    }

    async add(a: number, b: number) {
      return a + b
    }

    async error() {
      throw new Error('Test error')
    }
  }

  let target: TestTarget

  beforeEach(() => {
    target = new TestTarget()
  })

  describe('Single Requests', () => {
    it('should handle valid RPC request', async () => {
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '1',
          method: 'echo',
          params: ['hello'],
        }),
      })

      const response = await newWorkersRpcResponse(target, request)
      expect(response.status).toBe(200)

      const body = (await response.json()) as RpcResponse
      expect(body.id).toBe('1')
      expect(body.result).toBe('hello')
    })

    it('should return error for unknown method', async () => {
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '1',
          method: 'nonexistent',
          params: [],
        }),
      })

      const response = await newWorkersRpcResponse(target, request)
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('not found')
    })

    it('should handle method errors', async () => {
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '1',
          method: 'error',
          params: [],
        }),
      })

      const response = await newWorkersRpcResponse(target, request)
      const body = (await response.json()) as RpcResponse
      expect(body.error).toBe('Test error')
    })

    it('should handle multiple parameters', async () => {
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '1',
          method: 'add',
          params: [5, 7],
        }),
      })

      const response = await newWorkersRpcResponse(target, request)
      const body = (await response.json()) as RpcResponse
      expect(body.result).toBe(12)
    })
  })

  describe('Batch Requests', () => {
    it('should handle batch RPC requests', async () => {
      const request = new Request('http://localhost/rpc/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: '1', method: 'echo', params: ['first'] },
          { id: '2', method: 'add', params: [1, 2] },
          { id: '3', method: 'echo', params: ['third'] },
        ]),
      })

      const response = await newWorkersRpcResponse(target, request)
      expect(response.status).toBe(200)

      const body = (await response.json()) as RpcBatchResponse
      expect(body.results).toHaveLength(3)
      expect(body.results[0].result).toBe('first')
      expect(body.results[1].result).toBe(3)
      expect(body.results[2].result).toBe('third')
    })

    it('should handle mixed success/failure in batch', async () => {
      const request = new Request('http://localhost/rpc/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: '1', method: 'echo', params: ['success'] },
          { id: '2', method: 'error', params: [] },
          { id: '3', method: 'add', params: [5, 5] },
        ]),
      })

      const response = await newWorkersRpcResponse(target, request)
      const body = (await response.json()) as RpcBatchResponse

      expect(body.results[0].result).toBe('success')
      expect(body.results[1].error).toBeDefined()
      expect(body.results[2].result).toBe(10)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid JSON', async () => {
      const request = new Request('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      const response = await newWorkersRpcResponse(target, request)
      expect(response.status).toBe(500)
    })
  })
})

// ============================================================================
// handleWebSocketRpc Tests
// ============================================================================

describe('handleWebSocketRpc', () => {
  // Mock WebSocket for testing
  function createMockWebSocket() {
    const listeners: Map<string, Array<(event: unknown) => void>> = new Map()
    const sentMessages: string[] = []

    return {
      addEventListener: (event: string, handler: (event: unknown) => void) => {
        if (!listeners.has(event)) {
          listeners.set(event, [])
        }
        listeners.get(event)!.push(handler)
      },
      send: (data: string) => {
        sentMessages.push(data)
      },
      close: () => {},
      // Test helpers
      _emit: (event: string, data: unknown) => {
        const handlers = listeners.get(event) || []
        for (const handler of handlers) {
          handler(data)
        }
      },
      _getSentMessages: () => sentMessages,
      _clearMessages: () => {
        sentMessages.length = 0
      },
    }
  }

  it('should handle RPC messages over WebSocket', async () => {
    class TestTarget extends RpcTarget {
      protected override allowedMethods = new Set(['echo'])
      async echo(msg: string) {
        return msg
      }
    }

    const target = new TestTarget()
    const socket = createMockWebSocket()

    handleWebSocketRpc(target, socket as unknown as WebSocket)

    // Simulate receiving a message
    socket._emit('message', {
      data: JSON.stringify({ id: '1', method: 'echo', params: ['test'] }),
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 10))

    const messages = socket._getSentMessages()
    expect(messages).toHaveLength(1)

    const response = JSON.parse(messages[0])
    expect(response.id).toBe('1')
    expect(response.result).toBe('test')
  })

  it('should handle method not found error', async () => {
    const target = new RpcTarget()
    const socket = createMockWebSocket()

    handleWebSocketRpc(target, socket as unknown as WebSocket)

    socket._emit('message', {
      data: JSON.stringify({ id: '1', method: 'unknown', params: [] }),
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const messages = socket._getSentMessages()
    const response = JSON.parse(messages[0])
    expect(response.error).toContain('not found')
  })

  it('should handle invalid JSON', async () => {
    const target = new RpcTarget()
    const socket = createMockWebSocket()

    handleWebSocketRpc(target, socket as unknown as WebSocket)

    socket._emit('message', { data: 'not valid json' })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const messages = socket._getSentMessages()
    const response = JSON.parse(messages[0])
    expect(response.error).toContain('Invalid JSON')
  })

  it('should call onOpen callback', () => {
    const target = new RpcTarget()
    const socket = createMockWebSocket()
    const onOpen = vi.fn()

    handleWebSocketRpc(target, socket as unknown as WebSocket, { onOpen })

    socket._emit('open', {})

    expect(onOpen).toHaveBeenCalled()
  })

  it('should call onClose callback', () => {
    const target = new RpcTarget()
    const socket = createMockWebSocket()
    const onClose = vi.fn()

    handleWebSocketRpc(target, socket as unknown as WebSocket, { onClose })

    socket._emit('close', {})

    expect(onClose).toHaveBeenCalled()
  })

  it('should dispose target on socket close', () => {
    class DisposableTarget extends RpcTarget {
      disposed = false;
      [Symbol.dispose]() {
        this.disposed = true
      }
    }

    const target = new DisposableTarget()
    const socket = createMockWebSocket()

    handleWebSocketRpc(target, socket as unknown as WebSocket)

    socket._emit('close', {})

    expect(target.disposed).toBe(true)
  })
})

// ============================================================================
// Factory Functions Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createShellApiRpcTarget', () => {
    it('should create a new ShellApiRpcTarget', () => {
      const target = createShellApiRpcTarget()

      expect(target).toBeInstanceOf(ShellApiRpcTarget)
      expect(target.hasMethod('exec')).toBe(true)
      expect(target.hasMethod('spawn')).toBe(true)

      target[Symbol.dispose]()
    })
  })

  describe('asRpcTarget', () => {
    it('should wrap existing ShellApiImpl', async () => {
      const api = new ShellApiImpl()
      const target = asRpcTarget(api)

      expect(target).toBeInstanceOf(ShellApiRpcTarget)

      // Should use the same underlying API
      const result = await target.exec('echo "wrapped"')
      expect(result.stdout).toContain('wrapped')

      target[Symbol.dispose]()
    })
  })
})

// ============================================================================
// Integration Tests with ShellApi
// ============================================================================

describe('ShellApiRpcTarget Integration', () => {
  let target: ShellApiRpcTarget

  beforeEach(() => {
    target = new ShellApiRpcTarget()
  })

  afterEach(() => {
    target[Symbol.dispose]()
  })

  describe('HTTP RPC with real commands', () => {
    it('should execute echo command via HTTP RPC', async () => {
      const request = new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '1',
          method: 'exec',
          params: ['echo "rpc test"'],
        }),
      })

      const response = await newWorkersRpcResponse(target, request)
      const body = (await response.json()) as RpcResponse

      expect(body.result).toHaveProperty('stdout')
      expect((body.result as { stdout: string }).stdout).toContain('rpc test')
    })

    it('should handle command with options via HTTP RPC', async () => {
      const request = new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '1',
          method: 'exec',
          params: ['echo $MY_VAR', { env: { MY_VAR: 'test_value' } }],
        }),
      })

      const response = await newWorkersRpcResponse(target, request)
      const body = (await response.json()) as RpcResponse

      expect((body.result as { stdout: string }).stdout).toContain('test_value')
    })
  })

  describe('Batch execution', () => {
    it('should handle batch command execution', async () => {
      const request = new Request('http://localhost/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: '1', method: 'exec', params: ['echo "first"'] },
          { id: '2', method: 'exec', params: ['echo "second"'] },
          { id: '3', method: 'exec', params: ['echo "third"'] },
        ]),
      })

      const response = await newWorkersRpcResponse(target, request)
      const body = (await response.json()) as RpcBatchResponse

      expect(body.results).toHaveLength(3)
      expect((body.results[0].result as { stdout: string }).stdout).toContain('first')
      expect((body.results[1].result as { stdout: string }).stdout).toContain('second')
      expect((body.results[2].result as { stdout: string }).stdout).toContain('third')
    })
  })
})
