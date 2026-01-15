/**
 * MCP Transport Tests
 *
 * Tests for the MCP transport module including:
 * - Client functionality
 * - Server functionality
 * - Tool registry
 * - Integration tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Client
  McpClient,
  createMcpClient,
  createHttpClient,
  createWorkerClient,

  // Server
  McpServer,
  createMcpServer,
  createToolServer,
  createMcpRequestHandler,

  // Tools
  ToolRegistry,
  createToolRegistry,
  defineTool,
  simpleTool,
  wrapFunction,
  validateToolArgs,
  formatToolResult,

  // Types
  type McpClientOptions,
  type McpServerOptions,
  type ToolRegistration,
  type McpTool,
  type McpToolResult,
} from '../index'

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockTool = (name: string): ToolRegistration => ({
  tool: {
    name,
    description: `Test tool: ${name}`,
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input value' },
      },
      required: ['input'],
    },
  },
  handler: async (params) => ({
    content: [{ type: 'text', text: `${name}: ${params.input}` }],
  }),
})

const createMockFetch = (response: unknown, sessionId?: string) => {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    json: () => Promise.resolve(response),
  })
}

// ============================================================================
// Tool Registry Tests
// ============================================================================

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createMockTool('test-tool')
      registry.register(tool)

      expect(registry.has('test-tool')).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('should register multiple tools', () => {
      registry.register(createMockTool('tool-1'))
      registry.register(createMockTool('tool-2'))
      registry.register(createMockTool('tool-3'))

      expect(registry.size).toBe(3)
    })
  })

  describe('unregister', () => {
    it('should unregister a tool', () => {
      registry.register(createMockTool('test-tool'))
      const result = registry.unregister('test-tool')

      expect(result).toBe(true)
      expect(registry.has('test-tool')).toBe(false)
    })

    it('should return false for non-existent tool', () => {
      const result = registry.unregister('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('get', () => {
    it('should get a registered tool', () => {
      const tool = createMockTool('test-tool')
      registry.register(tool)

      const retrieved = registry.get('test-tool')
      expect(retrieved).toBeDefined()
      expect(retrieved?.tool.name).toBe('test-tool')
    })

    it('should return undefined for non-existent tool', () => {
      const retrieved = registry.get('non-existent')
      expect(retrieved).toBeUndefined()
    })
  })

  describe('getAll', () => {
    it('should return all enabled tools', () => {
      registry.register(createMockTool('tool-1'))
      registry.register(createMockTool('tool-2'))
      registry.register({ ...createMockTool('tool-3'), enabled: false })

      const tools = registry.getAll()
      expect(tools).toHaveLength(2)
    })
  })

  describe('aliases', () => {
    it('should support tool aliases', () => {
      registry.register(createMockTool('my-tool'))
      registry.addAlias('alias', 'my-tool')

      expect(registry.has('alias')).toBe(true)
      const tool = registry.get('alias')
      expect(tool?.tool.name).toBe('my-tool')
    })

    it('should remove alias when tool is unregistered', () => {
      registry.register(createMockTool('my-tool'))
      registry.addAlias('alias', 'my-tool')
      registry.unregister('my-tool')

      expect(registry.has('alias')).toBe(false)
    })
  })

  describe('call', () => {
    it('should call a tool handler', async () => {
      registry.register(createMockTool('echo'))

      const result = await registry.call('echo', { input: 'hello' }, { sessionId: 'test' })

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBe('echo: hello')
    })

    it('should return error for non-existent tool', async () => {
      const result = await registry.call('non-existent', {}, { sessionId: 'test' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not found')
    })

    it('should return error for disabled tool', async () => {
      registry.register({ ...createMockTool('disabled'), enabled: false })

      const result = await registry.call('disabled', { input: 'test' }, { sessionId: 'test' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('disabled')
    })
  })
})

// ============================================================================
// Tool Definition Helpers Tests
// ============================================================================

describe('Tool Definition Helpers', () => {
  describe('defineTool', () => {
    it('should create a tool registration', () => {
      const tool = defineTool(
        'add',
        'Add two numbers',
        {
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
        async (params) => ({
          content: [{ type: 'text', text: String(params.a + params.b) }],
        })
      )

      expect(tool.tool.name).toBe('add')
      expect(tool.tool.description).toBe('Add two numbers')
      expect(tool.handler).toBeDefined()
    })
  })

  describe('simpleTool', () => {
    it('should create a simple tool', async () => {
      const tool = simpleTool('greet', 'Greet someone', (params) => `Hello, ${params.name}!`)

      expect(tool.tool.name).toBe('greet')

      const result = await tool.handler({ name: 'World' }, { sessionId: 'test' })
      expect(result.content[0].text).toBe('Hello, World!')
    })
  })

  describe('wrapFunction', () => {
    it('should wrap an async function as a tool', async () => {
      const tool = wrapFunction(
        'double',
        'Double a number',
        {
          properties: {
            n: { type: 'number', description: 'Number to double' },
          },
          required: ['n'],
        },
        async (params: { n: number }) => params.n * 2
      )

      const result = await tool.handler({ n: 5 }, { sessionId: 'test' })
      expect(result.content[0].text).toBe('10')
    })

    it('should use custom formatter', async () => {
      const tool = wrapFunction(
        'calc',
        'Calculate',
        { properties: { x: { type: 'number' } } },
        async (params: { x: number }) => params.x + 1,
        { formatResult: (r) => `Result is: ${r}` }
      )

      const result = await tool.handler({ x: 10 }, { sessionId: 'test' })
      expect(result.content[0].text).toBe('Result is: 11')
    })
  })
})

// ============================================================================
// Tool Validation Tests
// ============================================================================

describe('validateToolArgs', () => {
  const tool: McpTool = {
    name: 'test',
    description: 'Test tool',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name' },
        age: { type: 'number', description: 'Age' },
      },
      required: ['name'],
    },
  }

  it('should validate valid args', () => {
    const result = validateToolArgs(tool, { name: 'Alice', age: 30 })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should catch missing required field', () => {
    const result = validateToolArgs(tool, { age: 30 })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: name')
  })

  it('should catch type mismatch', () => {
    const result = validateToolArgs(tool, { name: 'Alice', age: 'thirty' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('should be number')
  })
})

describe('formatToolResult', () => {
  it('should format text content', () => {
    const result: McpToolResult = {
      content: [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ],
    }

    expect(formatToolResult(result)).toBe('Line 1\nLine 2')
  })

  it('should handle empty result', () => {
    const result: McpToolResult = { content: [] }
    expect(formatToolResult(result)).toBe('')
  })
})

// ============================================================================
// MCP Server Tests
// ============================================================================

describe('McpServer', () => {
  let server: McpServer

  beforeEach(() => {
    server = createMcpServer({
      serverInfo: { name: 'test-server', version: '1.0.0' },
      tools: [createMockTool('echo')],
    })
  })

  describe('tool management', () => {
    it('should register tools', () => {
      server.registerTool(createMockTool('new-tool'))
      expect(server.hasTool('new-tool')).toBe(true)
    })

    it('should unregister tools', () => {
      server.unregisterTool('echo')
      expect(server.hasTool('echo')).toBe(false)
    })

    it('should list all tools', () => {
      server.registerTool(createMockTool('tool-2'))
      const tools = server.getTools()
      expect(tools).toHaveLength(2)
    })
  })

  describe('handleRequest', () => {
    it('should handle initialize request', async () => {
      const request = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      const response = await server.handleRequest(request)
      const json = await response.json()

      expect(json.result).toBeDefined()
      expect(json.result.protocolVersion).toBe('2024-11-05')
      expect(json.result.serverInfo.name).toBe('test-server')
    })

    it('should handle ping request', async () => {
      const request = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
        }),
      })

      const response = await server.handleRequest(request)
      const json = await response.json()

      expect(json.result).toEqual({})
    })

    it('should handle tools/list request', async () => {
      // First initialize
      const initRequest = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      })

      const initResponse = await server.handleRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')

      // Then list tools
      const request = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      })

      const response = await server.handleRequest(request)
      const json = await response.json()

      expect(json.result.tools).toHaveLength(1)
      expect(json.result.tools[0].name).toBe('echo')
    })

    it('should handle tools/call request', async () => {
      // Initialize
      const initRequest = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      })

      const initResponse = await server.handleRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')

      // Call tool
      const request = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { input: 'hello' },
          },
        }),
      })

      const response = await server.handleRequest(request)
      const json = await response.json()

      expect(json.result.content[0].text).toBe('echo: hello')
    })

    it('should reject invalid JSON-RPC version', async () => {
      const request = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '1.0',
          id: 1,
          method: 'ping',
        }),
      })

      const response = await server.handleRequest(request)
      const json = await response.json()

      expect(json.error).toBeDefined()
      expect(json.error.code).toBe(-32600)
    })

    it('should handle DELETE request', async () => {
      // Initialize first
      const initRequest = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      })

      const initResponse = await server.handleRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')

      // Delete session
      const deleteRequest = new Request('https://test.local/mcp', {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId! },
      })

      const deleteResponse = await server.handleRequest(deleteRequest)
      expect(deleteResponse.status).toBe(204)
    })
  })
})

// ============================================================================
// MCP Client Tests
// ============================================================================

describe('McpClient', () => {
  describe('createHttpClient', () => {
    it('should create a client with default config', () => {
      const client = createHttpClient('https://test.local/mcp')
      expect(client).toBeInstanceOf(McpClient)
      expect(client.getState()).toBe('disconnected')
    })
  })

  describe('connect', () => {
    it('should connect and initialize session', async () => {
      const mockFetch = createMockFetch(
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'test', version: '1.0.0' },
            capabilities: { tools: { listChanged: true } },
          },
        },
        'session-123'
      )

      // Mock subsequent requests (tools/list, resources/list)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Mcp-Session-Id': 'session-123' }),
          json: () =>
            Promise.resolve({
              jsonrpc: '2.0',
              id: 1,
              result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'test', version: '1.0.0' },
                capabilities: {},
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: () => Promise.resolve({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: () => Promise.resolve({ jsonrpc: '2.0', id: 3, result: { resources: [] } }),
        })

      const client = createMcpClient({
        clientInfo: { name: 'test-client', version: '1.0.0' },
        transport: {
          type: 'http',
          url: 'https://test.local/mcp',
          fetch: mockFetch,
        },
      })

      await client.connect()

      expect(client.getState()).toBe('initialized')
      expect(client.getServerInfo()?.name).toBe('test')
    })
  })

  describe('callTool', () => {
    it('should call a tool and return result', async () => {
      const mockFetch = vi.fn()
        // initialize
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Mcp-Session-Id': 'session-123' }),
          json: () =>
            Promise.resolve({
              jsonrpc: '2.0',
              id: 1,
              result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'test', version: '1.0.0' },
                capabilities: {},
              },
            }),
        })
        // notifications/initialized (no response needed but mock must handle it)
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          headers: new Headers({ 'Mcp-Session-Id': 'session-123' }),
          json: () => Promise.resolve(null),
        })
        // tools/list
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Mcp-Session-Id': 'session-123' }),
          json: () =>
            Promise.resolve({
              jsonrpc: '2.0',
              id: 2,
              result: {
                tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
              },
            }),
        })
        // resources/list
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Mcp-Session-Id': 'session-123' }),
          json: () =>
            Promise.resolve({ jsonrpc: '2.0', id: 3, result: { resources: [] } }),
        })
        // tools/call
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Mcp-Session-Id': 'session-123' }),
          json: () =>
            Promise.resolve({
              jsonrpc: '2.0',
              id: 4,
              result: {
                content: [{ type: 'text', text: 'Echo: hello' }],
              },
            }),
        })

      const client = createMcpClient({
        clientInfo: { name: 'test-client', version: '1.0.0' },
        transport: {
          type: 'http',
          url: 'https://test.local/mcp',
          fetch: mockFetch,
        },
      })

      await client.connect()
      const result = await client.callTool('echo', { message: 'hello' })

      expect(result.result.content[0].text).toBe('Echo: hello')
      expect(result.tool).toBe('echo')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Client-Server Integration', () => {
  it('should connect client to server', async () => {
    // Create server
    const server = createMcpServer({
      serverInfo: { name: 'integration-server', version: '1.0.0' },
      tools: [
        {
          tool: {
            name: 'add',
            description: 'Add two numbers',
            inputSchema: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
              },
              required: ['a', 'b'],
            },
          },
          handler: async (params) => ({
            content: [{ type: 'text', text: String((params.a as number) + (params.b as number)) }],
          }),
        },
      ],
    })

    // Create mock fetch that uses the server
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const request = new Request(url, init)
      return server.handleRequest(request)
    })

    // Create client
    const client = createMcpClient({
      clientInfo: { name: 'test-client', version: '1.0.0' },
      transport: {
        type: 'http',
        url: 'https://test.local/mcp',
        fetch: mockFetch,
      },
    })

    // Connect
    await client.connect()
    expect(client.getState()).toBe('initialized')

    // List tools
    const tools = client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('add')

    // Call tool
    const result = await client.callTool('add', { a: 2, b: 3 })
    expect(result.result.content[0].text).toBe('5')

    // Disconnect
    await client.disconnect()
    expect(client.getState()).toBe('disconnected')
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createToolServer', () => {
    it('should create a server with tools only', () => {
      const server = createToolServer({ name: 'tool-server', version: '1.0.0' }, [createMockTool('test')])

      expect(server.getTools()).toHaveLength(1)
    })
  })

  describe('createMcpRequestHandler', () => {
    it('should create a request handler function', async () => {
      const server = createMcpServer({
        serverInfo: { name: 'handler-server', version: '1.0.0' },
      })

      const handler = createMcpRequestHandler(server)

      const request = new Request('https://test.local/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      })

      const response = await handler(request)
      const json = await response.json()

      expect(json.result).toEqual({})
    })
  })
})
