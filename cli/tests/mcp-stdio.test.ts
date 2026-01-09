/**
 * MCP stdio Bridge Tests (TDD RED Phase)
 *
 * Tests for Model Context Protocol communication over stdin/stdout for CLI tools.
 * These tests are written BEFORE implementation exists and should FAIL.
 *
 * The MCP stdio transport enables:
 * - JSON-RPC 2.0 message passing over stdin/stdout
 * - Newline-delimited JSON message framing
 * - Tool invocation and response handling
 * - Session management for persistent connections
 *
 * Implementation location: cli/mcp-stdio.ts
 *
 * @see https://modelcontextprotocol.io/docs/concepts/transports
 * @see https://www.jsonrpc.org/specification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// Import the MCP stdio module (will fail - module doesn't exist yet)
// ============================================================================

import {
  // Core transport
  McpStdioTransport,
  createStdioTransport,

  // Message handling
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  createMessageFramer,

  // Session management
  createStdioSession,
  type StdioSession,

  // Types
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type TransportOptions,
  type MessageHandler,
} from '../mcp-stdio'

// ============================================================================
// Type Definitions for Tests
// ============================================================================

interface MockReadable {
  on: (event: string, callback: (...args: unknown[]) => void) => void
  pipe: (destination: unknown) => unknown
  destroy: () => void
}

interface MockWritable {
  write: (data: string | Buffer, callback?: () => void) => boolean
  end: (callback?: () => void) => void
  destroy: () => void
}

interface MockProcess {
  stdin: MockReadable
  stdout: MockWritable
  stderr: MockWritable
}

// ============================================================================
// Mock Setup
// ============================================================================

// Mock stdin/stdout streams
const createMockReadable = (): MockReadable & { emit: (event: string, ...args: unknown[]) => void } => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(callback)
    },
    pipe: (destination: unknown) => destination,
    destroy: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      listeners[event]?.forEach((cb) => cb(...args))
    },
  }
}

const createMockWritable = (): MockWritable & { getWritten: () => string[] } => {
  const written: string[] = []
  return {
    write: vi.fn((data: string | Buffer, callback?: () => void) => {
      written.push(typeof data === 'string' ? data : data.toString())
      callback?.()
      return true
    }),
    end: vi.fn((callback?: () => void) => {
      callback?.()
    }),
    destroy: vi.fn(),
    getWritten: () => written,
  }
}

// ============================================================================
// Stdio Transport Initialization Tests
// ============================================================================

describe('McpStdioTransport', () => {
  describe('initialization', () => {
    it('creates a transport from stdin/stdout streams', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })

      expect(transport).toBeDefined()
      expect(transport).toBeInstanceOf(McpStdioTransport)
    })

    it('exports createStdioTransport factory function', () => {
      expect(createStdioTransport).toBeDefined()
      expect(typeof createStdioTransport).toBe('function')
    })

    it('createStdioTransport creates configured transport', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = createStdioTransport({ stdin, stdout })

      expect(transport).toBeInstanceOf(McpStdioTransport)
    })

    it('accepts optional stderr stream for errors', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const stderr = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout, stderr })

      expect(transport).toBeDefined()
    })

    it('starts in disconnected state', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })

      expect(transport.isConnected()).toBe(false)
    })

    it('connects when start() is called', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()

      expect(transport.isConnected()).toBe(true)
    })

    it('disconnects when close() is called', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()
      await transport.close()

      expect(transport.isConnected()).toBe(false)
    })

    it('emits "connected" event on start', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const onConnected = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.on('connected', onConnected)
      await transport.start()

      expect(onConnected).toHaveBeenCalled()
    })

    it('emits "disconnected" event on close', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const onDisconnected = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.on('disconnected', onDisconnected)
      await transport.start()
      await transport.close()

      expect(onDisconnected).toHaveBeenCalled()
    })

    it('throws if started while already connected', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()

      await expect(transport.start()).rejects.toThrow()
    })

    it('is idempotent when closing multiple times', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()

      // Multiple closes should not throw
      await expect(transport.close()).resolves.not.toThrow()
      await expect(transport.close()).resolves.not.toThrow()
    })
  })

  describe('configuration options', () => {
    it('accepts custom message delimiter', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({
        stdin,
        stdout,
        delimiter: '\r\n',
      })

      expect(transport).toBeDefined()
    })

    it('accepts custom encoding option', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({
        stdin,
        stdout,
        encoding: 'utf-8',
      })

      expect(transport).toBeDefined()
    })

    it('accepts message size limit option', () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({
        stdin,
        stdout,
        maxMessageSize: 1024 * 1024, // 1MB
      })

      expect(transport).toBeDefined()
    })
  })
})

// ============================================================================
// JSON-RPC Message Parsing Tests
// ============================================================================

describe('JSON-RPC Message Parsing', () => {
  describe('parseJsonRpcMessage', () => {
    it('parses valid JSON-RPC request', () => {
      const input = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

      const result = parseJsonRpcMessage(input)

      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      })
    })

    it('parses JSON-RPC request with string id', () => {
      const input = '{"jsonrpc":"2.0","id":"abc-123","method":"tools/list"}'

      const result = parseJsonRpcMessage(input)

      expect(result.id).toBe('abc-123')
    })

    it('parses JSON-RPC notification (no id)', () => {
      const input = '{"jsonrpc":"2.0","method":"notifications/cancelled"}'

      const result = parseJsonRpcMessage(input)

      expect(result).toEqual({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
      })
      expect(result.id).toBeUndefined()
    })

    it('parses JSON-RPC response with result', () => {
      const input = '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}'

      const result = parseJsonRpcMessage(input)

      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [] },
      })
    })

    it('parses JSON-RPC error response', () => {
      const input = '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request"}}'

      const result = parseJsonRpcMessage(input)

      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      })
    })

    it('throws on invalid JSON', () => {
      const input = 'not valid json {'

      expect(() => parseJsonRpcMessage(input)).toThrow()
    })

    it('throws on missing jsonrpc version', () => {
      const input = '{"id":1,"method":"test"}'

      expect(() => parseJsonRpcMessage(input)).toThrow()
    })

    it('throws on wrong jsonrpc version', () => {
      const input = '{"jsonrpc":"1.0","id":1,"method":"test"}'

      expect(() => parseJsonRpcMessage(input)).toThrow()
    })

    it('throws on invalid id type (array)', () => {
      const input = '{"jsonrpc":"2.0","id":[],"method":"test"}'

      expect(() => parseJsonRpcMessage(input)).toThrow()
    })

    it('throws on invalid id type (object)', () => {
      const input = '{"jsonrpc":"2.0","id":{},"method":"test"}'

      expect(() => parseJsonRpcMessage(input)).toThrow()
    })

    it('accepts null id (for error responses)', () => {
      const input = '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}'

      const result = parseJsonRpcMessage(input)

      expect(result.id).toBeNull()
    })

    it('parses params as object', () => {
      const input = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hello"}}}'

      const result = parseJsonRpcMessage(input)

      expect(result.params).toEqual({
        name: 'echo',
        arguments: { message: 'hello' },
      })
    })

    it('throws on params as array (MCP requires objects)', () => {
      const input = '{"jsonrpc":"2.0","id":1,"method":"test","params":["arg1","arg2"]}'

      expect(() => parseJsonRpcMessage(input)).toThrow()
    })

    it('handles empty params', () => {
      const input = '{"jsonrpc":"2.0","id":1,"method":"ping"}'

      const result = parseJsonRpcMessage(input)

      expect(result.params).toBeUndefined()
    })
  })

  describe('serializeJsonRpcMessage', () => {
    it('serializes request to JSON string', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }

      const result = serializeJsonRpcMessage(message)

      expect(JSON.parse(result)).toEqual(message)
    })

    it('serializes response with result', () => {
      const message: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [] },
      }

      const result = serializeJsonRpcMessage(message)

      expect(JSON.parse(result)).toEqual(message)
    })

    it('serializes error response', () => {
      const message: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      }

      const result = serializeJsonRpcMessage(message)

      expect(JSON.parse(result)).toEqual(message)
    })

    it('serializes notification (no id)', () => {
      const message: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progress: 50 },
      }

      const result = serializeJsonRpcMessage(message)

      expect(JSON.parse(result)).toEqual(message)
    })

    it('does not include newline in output', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      }

      const result = serializeJsonRpcMessage(message)

      expect(result).not.toContain('\n')
    })

    it('produces compact JSON (no extra whitespace)', () => {
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: { key: 'value' },
      }

      const result = serializeJsonRpcMessage(message)

      // Should not have indentation or extra spaces
      expect(result).not.toMatch(/\n\s+/)
    })
  })
})

// ============================================================================
// Message Framing Tests
// ============================================================================

describe('Message Framing', () => {
  describe('createMessageFramer', () => {
    it('creates a framer that handles newline-delimited messages', () => {
      const framer = createMessageFramer()

      expect(framer).toBeDefined()
      expect(typeof framer.push).toBe('function')
      expect(typeof framer.getMessages).toBe('function')
    })

    it('extracts complete messages ending with newline', () => {
      const framer = createMessageFramer()

      framer.push('{"jsonrpc":"2.0","id":1,"method":"test"}\n')
      const messages = framer.getMessages()

      expect(messages).toHaveLength(1)
      expect(messages[0]).toBe('{"jsonrpc":"2.0","id":1,"method":"test"}')
    })

    it('buffers incomplete messages', () => {
      const framer = createMessageFramer()

      framer.push('{"jsonrpc":"2.0","id":1,')
      const messages = framer.getMessages()

      expect(messages).toHaveLength(0)
    })

    it('combines chunked messages', () => {
      const framer = createMessageFramer()

      framer.push('{"jsonrpc":"2.0",')
      framer.push('"id":1,')
      framer.push('"method":"test"}\n')

      const messages = framer.getMessages()

      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0])).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      })
    })

    it('handles multiple messages in one chunk', () => {
      const framer = createMessageFramer()

      framer.push('{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","id":2,"method":"b"}\n')

      const messages = framer.getMessages()

      expect(messages).toHaveLength(2)
      expect(JSON.parse(messages[0]).method).toBe('a')
      expect(JSON.parse(messages[1]).method).toBe('b')
    })

    it('handles messages with embedded newlines in strings', () => {
      const framer = createMessageFramer()

      // JSON with escaped newline in string value
      framer.push('{"jsonrpc":"2.0","id":1,"method":"test","params":{"text":"line1\\nline2"}}\n')

      const messages = framer.getMessages()

      expect(messages).toHaveLength(1)
      const parsed = JSON.parse(messages[0])
      expect(parsed.params.text).toBe('line1\nline2')
    })

    it('clears buffer after getting messages', () => {
      const framer = createMessageFramer()

      framer.push('{"jsonrpc":"2.0","id":1,"method":"test"}\n')
      framer.getMessages() // First call
      const secondCall = framer.getMessages()

      expect(secondCall).toHaveLength(0)
    })

    it('preserves partial message after getting complete ones', () => {
      const framer = createMessageFramer()

      framer.push('{"jsonrpc":"2.0","id":1,"method":"complete"}\n{"jsonrpc":"2.0","id":2,')
      framer.getMessages()

      framer.push('"method":"partial"}\n')
      const messages = framer.getMessages()

      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0]).method).toBe('partial')
    })

    it('accepts custom delimiter', () => {
      const framer = createMessageFramer({ delimiter: '\r\n' })

      framer.push('{"jsonrpc":"2.0","id":1,"method":"test"}\r\n')
      const messages = framer.getMessages()

      expect(messages).toHaveLength(1)
    })

    it('resets buffer on reset() call', () => {
      const framer = createMessageFramer()

      framer.push('{"incomplete":')
      framer.reset()
      framer.push('{"jsonrpc":"2.0","id":1,"method":"test"}\n')

      const messages = framer.getMessages()

      expect(messages).toHaveLength(1)
      expect(JSON.parse(messages[0]).method).toBe('test')
    })

    it('reports buffer size', () => {
      const framer = createMessageFramer()

      framer.push('{"some":"data"')
      expect(framer.bufferSize()).toBe(14)

      framer.push('}\n')
      framer.getMessages()
      expect(framer.bufferSize()).toBe(0)
    })

    it('throws when buffer exceeds max size', () => {
      const framer = createMessageFramer({ maxBufferSize: 100 })

      expect(() => {
        framer.push('x'.repeat(200))
      }).toThrow(/buffer.*size|overflow/i)
    })
  })
})

// ============================================================================
// Response Writing Tests
// ============================================================================

describe('Response Writing to stdout', () => {
  it('writes JSON-RPC response followed by newline', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      result: { success: true },
    })

    const written = stdout.getWritten()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/\n$/)
  })

  it('serializes response to valid JSON', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: ['echo', 'create_thing'] },
    })

    const written = stdout.getWritten()
    const parsed = JSON.parse(written[0].trim())

    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(1)
    expect(parsed.result.tools).toEqual(['echo', 'create_thing'])
  })

  it('writes error response correctly', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32601,
        message: 'Method not found',
      },
    })

    const written = stdout.getWritten()
    const parsed = JSON.parse(written[0].trim())

    expect(parsed.error.code).toBe(-32601)
    expect(parsed.error.message).toBe('Method not found')
  })

  it('queues writes when transport is busy', async () => {
    const stdin = createMockReadable()
    const slowStdout = createMockWritable()
    let writeCount = 0

    // Simulate slow writes
    slowStdout.write = vi.fn((data: string, callback?: () => void) => {
      writeCount++
      setTimeout(() => callback?.(), 10)
      return true
    })

    const transport = new McpStdioTransport({ stdin, stdout: slowStdout })
    await transport.start()

    // Send multiple messages rapidly
    const promises = [
      transport.send({ jsonrpc: '2.0', id: 1, result: {} }),
      transport.send({ jsonrpc: '2.0', id: 2, result: {} }),
      transport.send({ jsonrpc: '2.0', id: 3, result: {} }),
    ]

    await Promise.all(promises)

    expect(writeCount).toBe(3)
  })

  it('throws when sending on closed transport', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()
    await transport.close()

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 1,
        result: {},
      })
    ).rejects.toThrow(/closed|disconnected/i)
  })

  it('handles write backpressure gracefully', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    // Simulate backpressure - write returns false
    stdout.write = vi.fn(() => false)

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    // Should not throw, should buffer
    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 1,
        result: {},
      })
    ).resolves.not.toThrow()
  })
})

// ============================================================================
// Tool Invocation Flow Tests
// ============================================================================

describe('Tool Invocation through stdio', () => {
  describe('receiving tool calls', () => {
    it('emits message event when receiving JSON-RPC request', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const onMessage = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.on('message', onMessage)
      await transport.start()

      // Simulate incoming message
      stdin.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo"}}\n'))

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
        })
      )
    })

    it('parses tools/call request with arguments', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const onMessage = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.on('message', onMessage)
      await transport.start()

      const toolCall = {
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'Hello, MCP!' },
        },
      }

      stdin.emit('data', Buffer.from(JSON.stringify(toolCall) + '\n'))

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            name: 'echo',
            arguments: { message: 'Hello, MCP!' },
          },
        })
      )
    })

    it('handles initialize request', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const onMessage = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.on('message', onMessage)
      await transport.start()

      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
          capabilities: {},
        },
      }

      stdin.emit('data', Buffer.from(JSON.stringify(initRequest) + '\n'))

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'initialize',
        })
      )
    })

    it('handles tools/list request', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const onMessage = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.on('message', onMessage)
      await transport.start()

      stdin.emit('data', Buffer.from('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'))

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'tools/list',
        })
      )
    })
  })

  describe('sending tool responses', () => {
    it('sends tool result in MCP format', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()

      await transport.send({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'Echo: Hello!' }],
        },
      })

      const written = stdout.getWritten()
      const parsed = JSON.parse(written[0].trim())

      expect(parsed.result.content).toEqual([{ type: 'text', text: 'Echo: Hello!' }])
    })

    it('sends tool error response', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()

      await transport.send({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'Error: Not found' }],
          isError: true,
        },
      })

      const written = stdout.getWritten()
      const parsed = JSON.parse(written[0].trim())

      expect(parsed.result.isError).toBe(true)
    })

    it('sends JSON-RPC error for invalid tool name', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const transport = new McpStdioTransport({ stdin, stdout })
      await transport.start()

      await transport.send({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32601,
          message: 'Tool not found: unknown_tool',
        },
      })

      const written = stdout.getWritten()
      const parsed = JSON.parse(written[0].trim())

      expect(parsed.error.code).toBe(-32601)
      expect(parsed.error.message).toContain('Tool not found')
    })
  })

  describe('message handler registration', () => {
    it('allows registering custom message handler', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()
      const handler: MessageHandler = vi.fn()

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.setMessageHandler(handler)
      await transport.start()

      stdin.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}\n'))

      expect(handler).toHaveBeenCalled()
    })

    it('handler receives parsed message and can send response', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const handler: MessageHandler = async (message, send) => {
        if (message.method === 'ping') {
          await send({
            jsonrpc: '2.0',
            id: message.id,
            result: {},
          })
        }
      }

      const transport = new McpStdioTransport({ stdin, stdout })
      transport.setMessageHandler(handler)
      await transport.start()

      stdin.emit('data', Buffer.from('{"jsonrpc":"2.0","id":99,"method":"ping"}\n'))

      // Wait for handler to execute
      await new Promise((resolve) => setTimeout(resolve, 10))

      const written = stdout.getWritten()
      const parsed = JSON.parse(written[0].trim())

      expect(parsed.id).toBe(99)
      expect(parsed.result).toEqual({})
    })
  })
})

// ============================================================================
// Session Management Tests
// ============================================================================

describe('Session Management', () => {
  describe('createStdioSession', () => {
    it('creates a new session with unique ID', () => {
      const session = createStdioSession()

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(typeof session.id).toBe('string')
      expect(session.id.length).toBeGreaterThan(0)
    })

    it('sessions have unique IDs', () => {
      const session1 = createStdioSession()
      const session2 = createStdioSession()

      expect(session1.id).not.toBe(session2.id)
    })

    it('tracks session creation timestamp', () => {
      const before = Date.now()
      const session = createStdioSession()
      const after = Date.now()

      expect(session.createdAt).toBeGreaterThanOrEqual(before)
      expect(session.createdAt).toBeLessThanOrEqual(after)
    })

    it('session starts in initialized state', () => {
      const session = createStdioSession()

      expect(session.state).toBe('created')
    })

    it('tracks client info when initialized', () => {
      const session = createStdioSession()

      session.initialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-cli', version: '1.0.0' },
        capabilities: {},
      })

      expect(session.clientInfo).toEqual({ name: 'test-cli', version: '1.0.0' })
      expect(session.state).toBe('initialized')
    })

    it('tracks last activity time', () => {
      const session = createStdioSession()
      const initialActivity = session.lastActivity

      // Simulate some time passing
      session.touch()

      expect(session.lastActivity).toBeGreaterThanOrEqual(initialActivity)
    })
  })

  describe('session state transitions', () => {
    it('transitions from created -> initialized -> running', () => {
      const session = createStdioSession()

      expect(session.state).toBe('created')

      session.initialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0' },
        capabilities: {},
      })

      expect(session.state).toBe('initialized')

      session.start()

      expect(session.state).toBe('running')
    })

    it('can transition to closed from any state', () => {
      const session1 = createStdioSession()
      session1.close()
      expect(session1.state).toBe('closed')

      const session2 = createStdioSession()
      session2.initialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0' },
        capabilities: {},
      })
      session2.close()
      expect(session2.state).toBe('closed')
    })

    it('prevents operations on closed session', () => {
      const session = createStdioSession()
      session.close()

      expect(() => {
        session.initialize({
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test', version: '1.0' },
          capabilities: {},
        })
      }).toThrow(/closed/)
    })
  })

  describe('session with transport', () => {
    it('associates session with transport', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const session = createStdioSession()
      const transport = new McpStdioTransport({ stdin, stdout })

      session.attachTransport(transport)

      expect(session.transport).toBe(transport)
    })

    it('session handles initialize message', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const session = createStdioSession()
      const transport = new McpStdioTransport({ stdin, stdout })
      session.attachTransport(transport)
      await transport.start()

      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test', version: '1.0' },
          capabilities: {},
        },
      }

      stdin.emit('data', Buffer.from(JSON.stringify(initRequest) + '\n'))

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(session.state).toBe('initialized')
    })

    it('session sends response through transport', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const session = createStdioSession()
      const transport = new McpStdioTransport({ stdin, stdout })
      session.attachTransport(transport)
      await transport.start()

      await session.respond(1, { success: true })

      const written = stdout.getWritten()
      expect(written.length).toBeGreaterThan(0)

      const parsed = JSON.parse(written[0].trim())
      expect(parsed.id).toBe(1)
      expect(parsed.result).toEqual({ success: true })
    })

    it('closes transport when session closes', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const session = createStdioSession()
      const transport = new McpStdioTransport({ stdin, stdout })
      session.attachTransport(transport)
      await transport.start()

      expect(transport.isConnected()).toBe(true)

      session.close()

      expect(transport.isConnected()).toBe(false)
    })
  })

  describe('session timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('session can have inactivity timeout', () => {
      const session = createStdioSession({ inactivityTimeout: 30000 }) // 30 seconds

      expect(session.inactivityTimeout).toBe(30000)
    })

    it('emits timeout event when inactive', async () => {
      const onTimeout = vi.fn()
      const session = createStdioSession({ inactivityTimeout: 1000 })
      session.on('timeout', onTimeout)
      session.startTimeoutTimer()

      vi.advanceTimersByTime(1500)

      expect(onTimeout).toHaveBeenCalled()
    })

    it('resets timeout on activity', async () => {
      const onTimeout = vi.fn()
      const session = createStdioSession({ inactivityTimeout: 1000 })
      session.on('timeout', onTimeout)
      session.startTimeoutTimer()

      vi.advanceTimersByTime(500)
      session.touch() // Activity resets timer

      vi.advanceTimersByTime(500)
      expect(onTimeout).not.toHaveBeenCalled()

      vi.advanceTimersByTime(600) // Now should timeout
      expect(onTimeout).toHaveBeenCalled()
    })
  })

  describe('session tools management', () => {
    it('session can register tools', () => {
      const session = createStdioSession()

      session.registerTool({
        name: 'my_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
      })

      expect(session.getTools()).toContainEqual(
        expect.objectContaining({ name: 'my_tool' })
      )
    })

    it('session can unregister tools', () => {
      const session = createStdioSession()

      session.registerTool({
        name: 'temp_tool',
        description: 'Temporary',
        inputSchema: { type: 'object', properties: {} },
      })

      session.unregisterTool('temp_tool')

      expect(session.getTools().find((t) => t.name === 'temp_tool')).toBeUndefined()
    })

    it('emits tools/list_changed notification when tools change', async () => {
      const stdin = createMockReadable()
      const stdout = createMockWritable()

      const session = createStdioSession()
      const transport = new McpStdioTransport({ stdin, stdout })
      session.attachTransport(transport)
      await transport.start()

      // Initialize first
      session.initialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0' },
        capabilities: {},
      })

      session.registerTool({
        name: 'new_tool',
        description: 'New tool',
        inputSchema: { type: 'object', properties: {} },
      })

      // Wait for notification to be sent
      await new Promise((resolve) => setTimeout(resolve, 10))

      const written = stdout.getWritten()
      const notifications = written.map((w) => JSON.parse(w.trim())).filter((m) => !m.id)

      expect(notifications).toContainEqual(
        expect.objectContaining({
          method: 'notifications/tools/list_changed',
        })
      )
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('emits error event on malformed JSON', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onError = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('error', onError)
    await transport.start()

    stdin.emit('data', Buffer.from('not valid json\n'))

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/parse|json/i),
      })
    )
  })

  it('sends parse error response for malformed JSON-RPC', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    stdin.emit('data', Buffer.from('{invalid json}\n'))

    // Wait for error handling
    await new Promise((resolve) => setTimeout(resolve, 10))

    const written = stdout.getWritten()
    if (written.length > 0) {
      const parsed = JSON.parse(written[0].trim())
      expect(parsed.error.code).toBe(-32700) // Parse error
    }
  })

  it('sends invalid request error for missing method', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    stdin.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1}\n'))

    await new Promise((resolve) => setTimeout(resolve, 10))

    const written = stdout.getWritten()
    if (written.length > 0) {
      const parsed = JSON.parse(written[0].trim())
      expect(parsed.error.code).toBe(-32600) // Invalid request
    }
  })

  it('handles stdin close gracefully', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onDisconnected = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('disconnected', onDisconnected)
    await transport.start()

    stdin.emit('close')

    expect(onDisconnected).toHaveBeenCalled()
    expect(transport.isConnected()).toBe(false)
  })

  it('handles stdin error event', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onError = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('error', onError)
    await transport.start()

    stdin.emit('error', new Error('stdin read error'))

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('handles stdout write error', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onError = vi.fn()

    stdout.write = vi.fn(() => {
      throw new Error('stdout write error')
    })

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('error', onError)
    await transport.start()

    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    })

    expect(onError).toHaveBeenCalled()
  })
})

// ============================================================================
// Edge Cases and Robustness Tests
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty message', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onError = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('error', onError)
    await transport.start()

    stdin.emit('data', Buffer.from('\n'))

    // Should handle gracefully, might emit error or just ignore
    expect(transport.isConnected()).toBe(true)
  })

  it('handles very large messages within limit', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onMessage = vi.fn()

    const transport = new McpStdioTransport({
      stdin,
      stdout,
      maxMessageSize: 1024 * 1024,
    })
    transport.on('message', onMessage)
    await transport.start()

    const largeData = 'x'.repeat(100000)
    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: { data: largeData },
    }

    stdin.emit('data', Buffer.from(JSON.stringify(message) + '\n'))

    expect(onMessage).toHaveBeenCalled()
  })

  it('rejects messages exceeding size limit', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onError = vi.fn()

    const transport = new McpStdioTransport({
      stdin,
      stdout,
      maxMessageSize: 100,
    })
    transport.on('error', onError)
    await transport.start()

    const largeMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: { data: 'x'.repeat(200) },
    })

    stdin.emit('data', Buffer.from(largeMessage + '\n'))

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/size|limit|too large/i),
      })
    )
  })

  it('handles rapid sequential messages', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onMessage = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('message', onMessage)
    await transport.start()

    for (let i = 0; i < 100; i++) {
      stdin.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: i,
            method: 'ping',
          }) + '\n'
        )
      )
    }

    expect(onMessage).toHaveBeenCalledTimes(100)
  })

  it('handles unicode in messages', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onMessage = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('message', onMessage)
    await transport.start()

    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: { text: 'Hello, world! Special chars: e, n, a, o' },
    }

    stdin.emit('data', Buffer.from(JSON.stringify(message) + '\n', 'utf-8'))

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          text: expect.stringContaining('e'),
        }),
      })
    )
  })

  it('handles concurrent reads and writes', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const onMessage = vi.fn()

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('message', onMessage)
    await transport.start()

    // Simulate concurrent activity
    const writePromises = []
    for (let i = 0; i < 10; i++) {
      writePromises.push(
        transport.send({
          jsonrpc: '2.0',
          id: 1000 + i,
          result: { index: i },
        })
      )

      stdin.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            jsonrpc: '2.0',
            id: i,
            method: 'ping',
          }) + '\n'
        )
      )
    }

    await Promise.all(writePromises)

    expect(onMessage).toHaveBeenCalledTimes(10)
    expect(stdout.getWritten().length).toBe(10)
  })

  it('preserves message order', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const transport = new McpStdioTransport({ stdin, stdout })
    await transport.start()

    const writes = [
      transport.send({ jsonrpc: '2.0', id: 1, result: { order: 1 } }),
      transport.send({ jsonrpc: '2.0', id: 2, result: { order: 2 } }),
      transport.send({ jsonrpc: '2.0', id: 3, result: { order: 3 } }),
    ]

    await Promise.all(writes)

    const written = stdout.getWritten()
    const orders = written.map((w) => JSON.parse(w.trim()).result.order)

    expect(orders).toEqual([1, 2, 3])
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Full MCP stdio Flow', () => {
  it('complete flow: initialize -> list tools -> call tool -> close', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const session = createStdioSession()
    const transport = new McpStdioTransport({ stdin, stdout })

    // Register a test tool
    session.registerTool({
      name: 'echo',
      description: 'Echo back input',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
    })

    session.attachTransport(transport)
    await transport.start()

    // 1. Initialize
    stdin.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'test-client', version: '1.0.0' },
            capabilities: {},
          },
        }) + '\n'
      )
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Check initialize response
    let written = stdout.getWritten()
    expect(written.length).toBeGreaterThan(0)

    // 2. List tools
    stdin.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }) + '\n'
      )
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    // 3. Call tool
    stdin.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message: 'Hello from test!' },
          },
        }) + '\n'
      )
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    // 4. Close session
    session.close()

    expect(transport.isConnected()).toBe(false)
    expect(session.state).toBe('closed')
  })

  it('handles bidirectional communication', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()
    const receivedMessages: JsonRpcMessage[] = []

    const transport = new McpStdioTransport({ stdin, stdout })
    transport.on('message', (msg) => receivedMessages.push(msg))
    await transport.start()

    // Client sends request
    stdin.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
        }) + '\n'
      )
    )

    // Server sends response
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    })

    // Client sends another request
    stdin.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }) + '\n'
      )
    )

    expect(receivedMessages).toHaveLength(2)
    expect(stdout.getWritten()).toHaveLength(1)
  })

  it('supports server-initiated notifications', async () => {
    const stdin = createMockReadable()
    const stdout = createMockWritable()

    const session = createStdioSession()
    const transport = new McpStdioTransport({ stdin, stdout })
    session.attachTransport(transport)
    await transport.start()

    // Initialize session first
    session.initialize({
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0' },
      capabilities: {},
    })

    // Server sends notification (no id)
    await session.notify('notifications/progress', {
      progressToken: 'task-1',
      progress: 50,
      total: 100,
    })

    const written = stdout.getWritten()
    const notification = JSON.parse(written[written.length - 1].trim())

    expect(notification.id).toBeUndefined()
    expect(notification.method).toBe('notifications/progress')
    expect(notification.params.progress).toBe(50)
  })
})
