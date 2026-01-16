/**
 * MCP Middleware TDD Tests
 *
 * RED PHASE: These tests define the expected API for the MCP middleware.
 * All tests should FAIL initially until the implementation is complete.
 *
 * Test scenarios:
 * 1. MCP middleware handles tool calls
 * 2. MCP middleware handles resource requests
 * 3. Proper JSON-RPC formatting
 * 4. Error handling for invalid requests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// Type Definitions for Tests
// ============================================================================

interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

interface ToolRegistration {
  tool: McpTool
  handler: (params: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult
}

interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

interface ResourceRegistration {
  resource: McpResource
  handler: (uri: string) => Promise<{ uri: string; text?: string; blob?: string; mimeType?: string }>
}

// ============================================================================
// Helper Functions
// ============================================================================

function createJsonRpcRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number = 1
) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  }
}

async function sendMcpRequest(
  app: Hono,
  path: string,
  body: object,
  headers: Record<string, string> = {}
) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

// ============================================================================
// Package Export Tests
// ============================================================================

describe('@dotdo/middleware MCP exports', () => {
  it('exports mcpMiddleware from main entry', async () => {
    const { mcpMiddleware } = await import('../src/index')
    expect(mcpMiddleware).toBeDefined()
    expect(typeof mcpMiddleware).toBe('function')
  })

  it('exports mcpMiddleware from mcp subpath', async () => {
    const { mcpMiddleware } = await import('../src/mcp')
    expect(mcpMiddleware).toBeDefined()
    expect(typeof mcpMiddleware).toBe('function')
  })

  it('exports ToolRegistry class', async () => {
    const { ToolRegistry } = await import('../src/mcp')
    expect(ToolRegistry).toBeDefined()
    expect(typeof ToolRegistry).toBe('function')
  })

  it('exports ResourceRegistry class', async () => {
    const { ResourceRegistry } = await import('../src/mcp')
    expect(ResourceRegistry).toBeDefined()
    expect(typeof ResourceRegistry).toBe('function')
  })

  it('exports createToolRegistry factory', async () => {
    const { createToolRegistry } = await import('../src/mcp')
    expect(createToolRegistry).toBeDefined()
    expect(typeof createToolRegistry).toBe('function')
  })

  it('exports createResourceRegistry factory', async () => {
    const { createResourceRegistry } = await import('../src/mcp')
    expect(createResourceRegistry).toBeDefined()
    expect(typeof createResourceRegistry).toBe('function')
  })
})

// ============================================================================
// MCP Middleware Configuration Tests
// ============================================================================

describe('mcpMiddleware configuration', () => {
  it('creates middleware with tool registry', async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    const middleware = mcpMiddleware({ tools })

    expect(typeof middleware).toBe('function')
  })

  it('creates middleware with resource registry', async () => {
    const { mcpMiddleware, createResourceRegistry } = await import('../src/mcp')

    const resources = createResourceRegistry()
    const middleware = mcpMiddleware({ resources })

    expect(typeof middleware).toBe('function')
  })

  it('creates middleware with both registries', async () => {
    const { mcpMiddleware, createToolRegistry, createResourceRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    const resources = createResourceRegistry()
    const middleware = mcpMiddleware({ tools, resources })

    expect(typeof middleware).toBe('function')
  })

  it('accepts serverInfo configuration', async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    const middleware = mcpMiddleware({
      tools,
      serverInfo: {
        name: 'test-server',
        version: '1.0.0',
      },
    })

    expect(typeof middleware).toBe('function')
  })
})

// ============================================================================
// Tool Registry Tests
// ============================================================================

describe('ToolRegistry', () => {
  it('registers a tool with handler', async () => {
    const { createToolRegistry } = await import('../src/mcp')

    const registry = createToolRegistry()
    registry.register({
      tool: {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
          required: ['input'],
        },
      },
      handler: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    })

    expect(registry.has('test_tool')).toBe(true)
  })

  it('gets all registered tools', async () => {
    const { createToolRegistry } = await import('../src/mcp')

    const registry = createToolRegistry()
    registry.register({
      tool: {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => ({ content: [{ type: 'text', text: '1' }] }),
    })
    registry.register({
      tool: {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => ({ content: [{ type: 'text', text: '2' }] }),
    })

    const tools = registry.getAll()
    expect(tools).toHaveLength(2)
    expect(tools.map(t => t.name)).toContain('tool1')
    expect(tools.map(t => t.name)).toContain('tool2')
  })

  it('calls tool handler with params', async () => {
    const { createToolRegistry } = await import('../src/mcp')

    const registry = createToolRegistry()
    let receivedParams: Record<string, unknown> | null = null

    registry.register({
      tool: {
        name: 'echo',
        description: 'Echo tool',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
      },
      handler: async (params) => {
        receivedParams = params
        return { content: [{ type: 'text', text: String(params.message) }] }
      },
    })

    const result = await registry.call('echo', { message: 'hello' })
    expect(receivedParams).toEqual({ message: 'hello' })
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' })
  })

  it('unregisters a tool', async () => {
    const { createToolRegistry } = await import('../src/mcp')

    const registry = createToolRegistry()
    registry.register({
      tool: {
        name: 'temp_tool',
        description: 'Temporary',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => ({ content: [] }),
    })

    expect(registry.has('temp_tool')).toBe(true)
    registry.unregister('temp_tool')
    expect(registry.has('temp_tool')).toBe(false)
  })
})

// ============================================================================
// Resource Registry Tests
// ============================================================================

describe('ResourceRegistry', () => {
  it('registers a resource with handler', async () => {
    const { createResourceRegistry } = await import('../src/mcp')

    const registry = createResourceRegistry()
    registry.register({
      resource: {
        uri: 'file:///test.txt',
        name: 'Test File',
        mimeType: 'text/plain',
      },
      handler: async () => ({
        uri: 'file:///test.txt',
        text: 'file contents',
      }),
    })

    expect(registry.has('file:///test.txt')).toBe(true)
  })

  it('gets all registered resources', async () => {
    const { createResourceRegistry } = await import('../src/mcp')

    const registry = createResourceRegistry()
    registry.register({
      resource: {
        uri: 'file:///a.txt',
        name: 'File A',
      },
      handler: async () => ({ uri: 'file:///a.txt', text: 'a' }),
    })
    registry.register({
      resource: {
        uri: 'file:///b.txt',
        name: 'File B',
      },
      handler: async () => ({ uri: 'file:///b.txt', text: 'b' }),
    })

    const resources = registry.getAll()
    expect(resources).toHaveLength(2)
    expect(resources.map(r => r.uri)).toContain('file:///a.txt')
    expect(resources.map(r => r.uri)).toContain('file:///b.txt')
  })

  it('reads resource content', async () => {
    const { createResourceRegistry } = await import('../src/mcp')

    const registry = createResourceRegistry()
    registry.register({
      resource: {
        uri: 'file:///data.json',
        name: 'Data File',
        mimeType: 'application/json',
      },
      handler: async () => ({
        uri: 'file:///data.json',
        text: '{"key": "value"}',
        mimeType: 'application/json',
      }),
    })

    const content = await registry.read('file:///data.json')
    expect(content.text).toBe('{"key": "value"}')
    expect(content.mimeType).toBe('application/json')
  })

  it('unregisters a resource', async () => {
    const { createResourceRegistry } = await import('../src/mcp')

    const registry = createResourceRegistry()
    registry.register({
      resource: {
        uri: 'file:///temp.txt',
        name: 'Temp',
      },
      handler: async () => ({ uri: 'file:///temp.txt', text: '' }),
    })

    expect(registry.has('file:///temp.txt')).toBe(true)
    registry.unregister('file:///temp.txt')
    expect(registry.has('file:///temp.txt')).toBe(false)
  })
})

// ============================================================================
// MCP Protocol: Initialize Tests
// ============================================================================

describe('MCP Protocol: initialize', () => {
  let app: Hono

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    tools.register({
      tool: {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    })

    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({
      tools,
      serverInfo: {
        name: 'test-mcp-server',
        version: '1.0.0',
      },
    }))
  })

  it('responds to initialize request', async () => {
    const res = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result).toBeDefined()
    expect(body.result.serverInfo.name).toBe('test-mcp-server')
    expect(body.result.protocolVersion).toBe('2024-11-05')
  })

  it('returns session ID header on initialize', async () => {
    const res = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }))

    const sessionId = res.headers.get('Mcp-Session-Id')
    expect(sessionId).toBeDefined()
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
  })

  it('returns server capabilities', async () => {
    const res = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }))

    const body = await res.json()
    expect(body.result.capabilities).toBeDefined()
    expect(body.result.capabilities.tools).toBeDefined()
  })
})

// ============================================================================
// MCP Protocol: tools/list Tests
// ============================================================================

describe('MCP Protocol: tools/list', () => {
  let app: Hono
  let sessionId: string

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    tools.register({
      tool: {
        name: 'search',
        description: 'Search for items',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      handler: async () => ({ content: [{ type: 'text', text: 'results' }] }),
    })
    tools.register({
      tool: {
        name: 'create',
        description: 'Create an item',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            data: { type: 'object' },
          },
          required: ['name'],
        },
      },
      handler: async () => ({ content: [{ type: 'text', text: 'created' }] }),
    })

    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools }))

    // Initialize session
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    sessionId = initRes.headers.get('Mcp-Session-Id')!
  })

  it('lists all registered tools', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/list'),
      { 'Mcp-Session-Id': sessionId }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.tools).toHaveLength(2)
    expect(body.result.tools.map((t: McpTool) => t.name)).toContain('search')
    expect(body.result.tools.map((t: McpTool) => t.name)).toContain('create')
  })

  it('returns tool schemas', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/list'),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    const searchTool = body.result.tools.find((t: McpTool) => t.name === 'search')
    expect(searchTool.description).toBe('Search for items')
    expect(searchTool.inputSchema.properties.query).toBeDefined()
    expect(searchTool.inputSchema.required).toContain('query')
  })
})

// ============================================================================
// MCP Protocol: tools/call Tests
// ============================================================================

describe('MCP Protocol: tools/call', () => {
  let app: Hono
  let sessionId: string

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    tools.register({
      tool: {
        name: 'echo',
        description: 'Echo back the input',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
      },
      handler: async (params) => ({
        content: [{ type: 'text', text: `Echo: ${params.message}` }],
      }),
    })
    tools.register({
      tool: {
        name: 'fail',
        description: 'A tool that always fails',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => {
        throw new Error('Intentional failure')
      },
    })

    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools }))

    // Initialize session
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    sessionId = initRes.headers.get('Mcp-Session-Id')!
  })

  it('calls tool and returns result', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/call', {
        name: 'echo',
        arguments: { message: 'hello world' },
      }),
      { 'Mcp-Session-Id': sessionId }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.content).toHaveLength(1)
    expect(body.result.content[0].text).toBe('Echo: hello world')
  })

  it('returns error for unknown tool', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/call', {
        name: 'nonexistent',
        arguments: {},
      }),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe(-32601) // Method not found
  })

  it('handles tool execution errors', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/call', {
        name: 'fail',
        arguments: {},
      }),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    // Tool errors are returned as isError: true in result, not JSON-RPC error
    expect(body.result).toBeDefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('Intentional failure')
  })

  it('validates required arguments', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/call', {
        name: 'echo',
        arguments: {}, // Missing required 'message'
      }),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe(-32602) // Invalid params
  })
})

// ============================================================================
// MCP Protocol: resources/list Tests
// ============================================================================

describe('MCP Protocol: resources/list', () => {
  let app: Hono
  let sessionId: string

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry, createResourceRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    const resources = createResourceRegistry()
    resources.register({
      resource: {
        uri: 'file:///config.json',
        name: 'Configuration',
        description: 'App configuration file',
        mimeType: 'application/json',
      },
      handler: async () => ({ uri: 'file:///config.json', text: '{}' }),
    })
    resources.register({
      resource: {
        uri: 'file:///readme.md',
        name: 'README',
        description: 'Documentation',
        mimeType: 'text/markdown',
      },
      handler: async () => ({ uri: 'file:///readme.md', text: '# Readme' }),
    })

    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools, resources }))

    // Initialize session
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    sessionId = initRes.headers.get('Mcp-Session-Id')!
  })

  it('lists all registered resources', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('resources/list'),
      { 'Mcp-Session-Id': sessionId }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.resources).toHaveLength(2)
    expect(body.result.resources.map((r: McpResource) => r.uri)).toContain('file:///config.json')
    expect(body.result.resources.map((r: McpResource) => r.uri)).toContain('file:///readme.md')
  })

  it('returns resource metadata', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('resources/list'),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    const config = body.result.resources.find((r: McpResource) => r.uri === 'file:///config.json')
    expect(config.name).toBe('Configuration')
    expect(config.description).toBe('App configuration file')
    expect(config.mimeType).toBe('application/json')
  })
})

// ============================================================================
// MCP Protocol: resources/read Tests
// ============================================================================

describe('MCP Protocol: resources/read', () => {
  let app: Hono
  let sessionId: string

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry, createResourceRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    const resources = createResourceRegistry()
    resources.register({
      resource: {
        uri: 'file:///data.txt',
        name: 'Data File',
        mimeType: 'text/plain',
      },
      handler: async () => ({
        uri: 'file:///data.txt',
        text: 'Hello, World!',
        mimeType: 'text/plain',
      }),
    })

    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools, resources }))

    // Initialize session
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    sessionId = initRes.headers.get('Mcp-Session-Id')!
  })

  it('reads resource content', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('resources/read', {
        uri: 'file:///data.txt',
      }),
      { 'Mcp-Session-Id': sessionId }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.contents).toHaveLength(1)
    expect(body.result.contents[0].text).toBe('Hello, World!')
    expect(body.result.contents[0].uri).toBe('file:///data.txt')
  })

  it('returns error for unknown resource', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('resources/read', {
        uri: 'file:///nonexistent.txt',
      }),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe(-32602) // Invalid params
  })
})

// ============================================================================
// JSON-RPC Error Handling Tests
// ============================================================================

describe('JSON-RPC error handling', () => {
  let app: Hono

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools }))
  })

  it('returns parse error for invalid JSON', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    })

    const body = await res.json()
    expect(body.error.code).toBe(-32700) // Parse error
  })

  it('returns invalid request for missing jsonrpc version', async () => {
    const res = await sendMcpRequest(app, '/mcp', {
      id: 1,
      method: 'initialize',
    })

    const body = await res.json()
    expect(body.error.code).toBe(-32600) // Invalid request
  })

  it('returns invalid request for wrong jsonrpc version', async () => {
    const res = await sendMcpRequest(app, '/mcp', {
      jsonrpc: '1.0',
      id: 1,
      method: 'initialize',
    })

    const body = await res.json()
    expect(body.error.code).toBe(-32600) // Invalid request
  })

  it('returns method not found for unknown method', async () => {
    // First initialize
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    const sessionId = initRes.headers.get('Mcp-Session-Id')!

    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('unknown/method'),
      { 'Mcp-Session-Id': sessionId }
    )

    const body = await res.json()
    expect(body.error.code).toBe(-32601) // Method not found
  })

  it('handles batch requests', async () => {
    const res = await sendMcpRequest(app, '/mcp', [
      createJsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0.0' },
      }, 1),
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ])

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
  })

  it('handles notifications (no id) without response', async () => {
    const res = await sendMcpRequest(app, '/mcp', {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
    })

    expect(res.status).toBe(204) // No content for notifications
  })
})

// ============================================================================
// Session Management Tests
// ============================================================================

describe('MCP session management', () => {
  let app: Hono

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    tools.register({
      tool: {
        name: 'test',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => ({ content: [] }),
    })

    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools }))
  })

  it('requires session for tools/list', async () => {
    const res = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('tools/list'))

    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe(-32600) // Invalid request - no session
  })

  it('rejects invalid session ID', async () => {
    const res = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/list'),
      { 'Mcp-Session-Id': 'invalid-session-id' }
    )

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('maintains session across requests', async () => {
    // Initialize
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    const sessionId = initRes.headers.get('Mcp-Session-Id')!

    // Use session for tools/list
    const listRes = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/list'),
      { 'Mcp-Session-Id': sessionId }
    )

    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(body.result.tools).toBeDefined()
  })
})

// ============================================================================
// HTTP Method Tests
// ============================================================================

describe('MCP HTTP methods', () => {
  let app: Hono

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools }))
  })

  it('only accepts POST for JSON-RPC', async () => {
    const res = await app.request('/mcp', { method: 'PUT' })
    expect(res.status).toBe(405)
  })

  it('handles GET for SSE connections', async () => {
    // First get a session
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    const sessionId = initRes.headers.get('Mcp-Session-Id')!

    const res = await app.request('/mcp', {
      method: 'GET',
      headers: { 'Mcp-Session-Id': sessionId },
    })

    // GET with session returns SSE stream
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
  })

  it('handles DELETE for session termination', async () => {
    // First get a session
    const initRes = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    const sessionId = initRes.headers.get('Mcp-Session-Id')!

    const res = await app.request('/mcp', {
      method: 'DELETE',
      headers: { 'Mcp-Session-Id': sessionId },
    })

    expect(res.status).toBe(204)

    // Session should be invalid now
    const listRes = await sendMcpRequest(
      app,
      '/mcp',
      createJsonRpcRequest('tools/list'),
      { 'Mcp-Session-Id': sessionId }
    )
    const body = await listRes.json()
    expect(body.error).toBeDefined()
  })
})

// ============================================================================
// Ping/Health Tests
// ============================================================================

describe('MCP ping', () => {
  let app: Hono

  beforeEach(async () => {
    const { mcpMiddleware, createToolRegistry } = await import('../src/mcp')

    const tools = createToolRegistry()
    app = new Hono()
    app.use('/mcp/*', mcpMiddleware({ tools }))
  })

  it('responds to ping without session', async () => {
    const res = await sendMcpRequest(app, '/mcp', createJsonRpcRequest('ping'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toEqual({})
  })
})
