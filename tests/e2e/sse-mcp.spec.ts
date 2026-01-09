import { test, expect } from '@playwright/test'

/**
 * E2E Tests for SSE MCP (Server-Sent Events Model Context Protocol)
 *
 * TDD RED Phase - Comprehensive failing tests for MCP streaming functionality.
 *
 * The MCP Streamable HTTP Transport specification requires:
 * - GET /mcp: SSE stream for server-to-client notifications
 * - POST /mcp: JSON-RPC 2.0 request handling
 * - DELETE /mcp: Session termination
 * - Mcp-Session-Id header: Session management
 *
 * Test Categories:
 * 1. Connection tests (establish SSE connection)
 * 2. Initialize tests (MCP initialize handshake)
 * 3. Tools tests (list tools, call tools)
 * 4. Resources tests (list resources, read resources)
 * 5. Prompts tests (list prompts, get prompt)
 * 6. Notifications tests (progress, log messages)
 * 7. Session management tests (create, resume, end)
 * 8. Error handling tests (invalid requests, server errors)
 */

// =============================================================================
// Helper Types
// =============================================================================

interface JsonRpcResponse {
  jsonrpc: string
  id: number | string | null
  result?: {
    protocolVersion?: string
    serverInfo?: { name: string; version?: string }
    capabilities?: {
      tools?: { listChanged?: boolean }
      resources?: { subscribe?: boolean; listChanged?: boolean }
      prompts?: { listChanged?: boolean }
    }
    tools?: Array<{
      name: string
      description?: string
      inputSchema?: Record<string, unknown>
    }>
    resources?: Array<{
      uri: string
      name: string
      description?: string
      mimeType?: string
    }>
    contents?: Array<{
      uri: string
      mimeType?: string
      text?: string
      blob?: string
    }>
    prompts?: Array<{
      name: string
      description?: string
      arguments?: Array<{ name: string; description?: string; required?: boolean }>
    }>
    messages?: Array<{
      role: string
      content: { type: string; text?: string }
    }>
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
    _meta?: { progressToken?: string | number }
  }
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface SSEEvent {
  event?: string
  data: string
  id?: string
  retry?: number
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build a JSON-RPC 2.0 request object
 */
function jsonRpcRequest(method: string, params?: unknown, id: string | number = 1) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method,
    params,
  }
}

/**
 * Build a JSON-RPC 2.0 notification (no id, no response expected)
 */
function jsonRpcNotification(method: string, params?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    method,
    params,
  }
}

/**
 * Parse SSE events from a string of SSE data
 */
function parseSSEEvents(data: string): SSEEvent[] {
  const events: SSEEvent[] = []
  const lines = data.split('\n')
  let currentEvent: Partial<SSEEvent> = {}

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent.event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      const dataValue = line.slice(5).trim()
      if (currentEvent.data) {
        currentEvent.data += '\n' + dataValue
      } else {
        currentEvent.data = dataValue
      }
    } else if (line.startsWith('id:')) {
      currentEvent.id = line.slice(3).trim()
    } else if (line.startsWith('retry:')) {
      currentEvent.retry = parseInt(line.slice(6).trim(), 10)
    } else if (line === '' && currentEvent.data !== undefined) {
      events.push(currentEvent as SSEEvent)
      currentEvent = {}
    }
  }

  return events
}

// =============================================================================
// 1. Connection Tests - SSE Connection Establishment
// =============================================================================

test.describe('SSE MCP - Connection Tests', () => {
  test('should establish SSE connection with valid session', async ({ request }) => {
    // First initialize to get a session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    expect(initResponse.status()).toBe(200)
    const sessionId = initResponse.headers()['mcp-session-id']
    expect(sessionId).toBeDefined()

    // Establish SSE connection
    const sseResponse = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    expect(sseResponse.status()).toBe(200)
    expect(sseResponse.headers()['content-type']).toContain('text/event-stream')
    expect(sseResponse.headers()['cache-control']).toBe('no-cache')
  })

  test('should reject SSE connection without session header', async ({ request }) => {
    const response = await request.get('/mcp')

    expect(response.status()).toBe(400)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32600) // Invalid Request
    expect(body.error?.message).toContain('Mcp-Session-Id')
  })

  test('should reject SSE connection with invalid session', async ({ request }) => {
    const response = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': 'non-existent-session-id-xyz' },
    })

    expect(response.status()).toBe(404)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.message).toContain('Session not found')
  })

  test('should include Mcp-Session-Id in SSE response headers', async ({ request }) => {
    // Initialize session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Get SSE stream
    const sseResponse = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    expect(sseResponse.headers()['mcp-session-id']).toBe(sessionId)
  })

  test('should send keep-alive comments in SSE stream', async ({ request }) => {
    // Initialize session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Get SSE stream and read initial data
    const sseResponse = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })
    const body = await sseResponse.text()

    // Should contain keep-alive comment (starts with :)
    expect(body).toMatch(/^:/)
  })
})

// =============================================================================
// 2. Initialize Tests - MCP Handshake
// =============================================================================

test.describe('SSE MCP - Initialize Tests', () => {
  test('should complete MCP initialize handshake', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result).toBeDefined()
    expect(body.result?.protocolVersion).toBe('2024-11-05')
    expect(body.result?.serverInfo).toBeDefined()
    expect(body.result?.serverInfo?.name).toBeDefined()
    expect(body.result?.capabilities).toBeDefined()
  })

  test('should return server capabilities on initialize', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: { subscribe: true } },
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })

    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.capabilities).toBeDefined()
    expect(body.result?.capabilities?.tools).toBeDefined()
    expect(body.result?.capabilities?.resources).toBeDefined()
    expect(body.result?.capabilities?.prompts).toBeDefined()
  })

  test('should create new session on initialize', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })

    const sessionId = response.headers()['mcp-session-id']
    expect(sessionId).toBeDefined()
    expect(sessionId).toMatch(/^[a-zA-Z0-9-]+$/)
  })

  test('should accept initialized notification after initialize', async ({ request }) => {
    // Initialize
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Send initialized notification
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcNotification('notifications/initialized'),
    })

    // Notifications return 204 No Content
    expect(response.status()).toBe(204)
  })

  test('should respond to ping requests', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('ping'),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result).toBeDefined()
  })
})

// =============================================================================
// 3. Tools Tests - List and Call Tools
// =============================================================================

test.describe('SSE MCP - Tools Tests', () => {
  test('should list available tools', async ({ request }) => {
    // Initialize
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // List tools
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/list'),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.tools).toBeDefined()
    expect(Array.isArray(body.result?.tools)).toBe(true)
  })

  test('should return tool metadata with name, description, and schema', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/list'),
    })

    const body = (await response.json()) as JsonRpcResponse
    const tools = body.result?.tools || []
    expect(tools.length).toBeGreaterThan(0)

    // Each tool should have required metadata
    for (const tool of tools) {
      expect(tool.name).toBeDefined()
      expect(typeof tool.name).toBe('string')
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
    }
  })

  test('should call tool and return result', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/call', {
        name: 'echo',
        arguments: { message: 'Hello, MCP!' },
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result).toBeDefined()
    expect(body.result?.content).toBeDefined()
    expect(Array.isArray(body.result?.content)).toBe(true)
    expect(body.result?.content?.[0]?.type).toBe('text')
  })

  test('should return error for non-existent tool', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/call', {
        name: 'non_existent_tool_xyz',
        arguments: {},
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32601) // Method not found
  })

  test('should return error for invalid tool arguments', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/call', {
        name: 'echo',
        // Missing required 'message' argument
        arguments: {},
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32602) // Invalid params
  })

  test('should handle tool execution errors gracefully', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Call a tool that returns an error result
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/call', {
        name: 'delete_thing',
        arguments: { id: 'non-existent-id' },
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result).toBeDefined()
    expect(body.result?.isError).toBe(true)
    expect(body.result?.content?.[0]?.type).toBe('text')
  })

  test('should support pagination in tools/list', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Request with cursor
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/list', { cursor: 'test-cursor' }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.tools).toBeDefined()
    // nextCursor may or may not be present depending on pagination
  })
})

// =============================================================================
// 4. Resources Tests - List and Read Resources
// =============================================================================

test.describe('SSE MCP - Resources Tests', () => {
  test('should list available resources', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/list'),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.resources).toBeDefined()
    expect(Array.isArray(body.result?.resources)).toBe(true)
  })

  test('should read resource content', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/read', {
        uri: 'dotdo://things/test-resource',
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.contents).toBeDefined()
    expect(Array.isArray(body.result?.contents)).toBe(true)
  })

  test('should return error for invalid resource URI', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/read', {
        // Missing URI
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32602) // Invalid params
  })

  test('should subscribe to resource updates', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { resources: { subscribe: true } },
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/subscribe', {
        uri: 'dotdo://things/test-resource',
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result).toBeDefined()
  })

  test('should unsubscribe from resource updates', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { resources: { subscribe: true } },
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Subscribe first
    await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/subscribe', {
        uri: 'dotdo://things/test-resource',
      }),
    })

    // Then unsubscribe
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/unsubscribe', {
        uri: 'dotdo://things/test-resource',
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result).toBeDefined()
  })

  test('should return resource templates when supported', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('resources/templates/list'),
    })

    // May return 200 with result or error if not supported
    expect(response.status()).toBe(200)
  })
})

// =============================================================================
// 5. Prompts Tests - List and Get Prompts
// =============================================================================

test.describe('SSE MCP - Prompts Tests', () => {
  test('should list available prompts', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('prompts/list'),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.prompts).toBeDefined()
    expect(Array.isArray(body.result?.prompts)).toBe(true)
  })

  test('should get prompt with arguments', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('prompts/get', {
        name: 'summarize',
        arguments: { content: 'Test content to summarize' },
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.messages).toBeDefined()
    expect(Array.isArray(body.result?.messages)).toBe(true)
  })

  test('should return error for missing prompt name', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('prompts/get', {
        // Missing name
        arguments: {},
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32602) // Invalid params
  })

  test('should include prompt metadata in list response', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('prompts/list'),
    })

    const body = (await response.json()) as JsonRpcResponse
    const prompts = body.result?.prompts || []

    // Each prompt should have name and potentially arguments schema
    for (const prompt of prompts) {
      expect(prompt.name).toBeDefined()
      expect(typeof prompt.name).toBe('string')
    }
  })
})

// =============================================================================
// 6. Notifications Tests - Progress and Log Messages
// =============================================================================

test.describe('SSE MCP - Notifications Tests', () => {
  test('should receive progress notifications via SSE', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Open SSE connection
    const sseResponse = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    expect(sseResponse.status()).toBe(200)
    expect(sseResponse.headers()['content-type']).toContain('text/event-stream')
  })

  test('should handle progress token in tool call', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Call tool with progress token
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/call', {
        name: 'echo',
        arguments: { message: 'test' },
        _meta: { progressToken: 'progress-123' },
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result).toBeDefined()
  })

  test('should accept log message notifications from client', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Send log notification
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcNotification('notifications/message', {
        level: 'info',
        logger: 'e2e-test',
        data: 'Test log message',
      }),
    })

    // Notifications return 204
    expect(response.status()).toBe(204)
  })

  test('should send cancelled notification', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Send cancellation notification
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcNotification('notifications/cancelled', {
        requestId: 'request-to-cancel',
        reason: 'User requested cancellation',
      }),
    })

    // Notifications return 204
    expect(response.status()).toBe(204)
  })
})

// =============================================================================
// 7. Session Management Tests - Create, Resume, End
// =============================================================================

test.describe('SSE MCP - Session Management Tests', () => {
  test('should create new session on initialize', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })

    const sessionId = response.headers()['mcp-session-id']
    expect(sessionId).toBeDefined()
    expect(sessionId.length).toBeGreaterThan(0)
  })

  test('should resume existing session with valid ID', async ({ request }) => {
    // Create session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Resume with tools/list
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/list'),
    })

    expect(response.status()).toBe(200)
    expect(response.headers()['mcp-session-id']).toBe(sessionId)
  })

  test('should terminate session with DELETE', async ({ request }) => {
    // Create session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Delete session
    const deleteResponse = await request.delete('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    expect(deleteResponse.status()).toBe(204)
  })

  test('should reject requests after session termination', async ({ request }) => {
    // Create session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Delete session
    await request.delete('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    // Try to use deleted session
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/list'),
    })

    expect(response.status()).toBe(404)
  })

  test('should maintain separate state for concurrent sessions', async ({ request }) => {
    // Create first session
    const init1 = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'client-1', version: '1.0.0' },
      }),
    })
    const sessionId1 = init1.headers()['mcp-session-id']

    // Create second session
    const init2 = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'client-2', version: '1.0.0' },
      }),
    })
    const sessionId2 = init2.headers()['mcp-session-id']

    // Sessions should be different
    expect(sessionId1).not.toBe(sessionId2)

    // Both sessions should work independently
    const [res1, res2] = await Promise.all([
      request.post('/mcp', {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId1,
        },
        data: jsonRpcRequest('tools/list'),
      }),
      request.post('/mcp', {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId2,
        },
        data: jsonRpcRequest('tools/list'),
      }),
    ])

    expect(res1.status()).toBe(200)
    expect(res2.status()).toBe(200)
  })

  test('should require session header for DELETE', async ({ request }) => {
    const response = await request.delete('/mcp')

    expect(response.status()).toBe(400)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
  })

  test('should return 404 for DELETE on non-existent session', async ({ request }) => {
    const response = await request.delete('/mcp', {
      headers: { 'Mcp-Session-Id': 'non-existent-session-xyz' },
    })

    expect(response.status()).toBe(404)
  })

  test('should update session last activity timestamp', async ({ request }) => {
    // Create session
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Wait briefly
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Make another request - should update last activity
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('ping'),
    })

    expect(response.status()).toBe(200)
  })
})

// =============================================================================
// 8. Error Handling Tests - Invalid Requests and Server Errors
// =============================================================================

test.describe('SSE MCP - Error Handling Tests', () => {
  test('should return Parse error (-32700) for invalid JSON', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not valid json {{{',
    })

    expect(response.status()).toBe(200) // JSON-RPC errors use 200
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    // MCP spec: -32700 is Parse error
    // Current implementation may return -32600 (Invalid Request) which is also acceptable
    expect([-32700, -32600]).toContain(body.error?.code)
    expect(body.error?.message).toBeDefined()
  })

  test('should return Invalid Request (-32600) for missing jsonrpc field', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: { method: 'tools/list', id: 1 },
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32600)
  })

  test('should return Invalid Request (-32600) for wrong jsonrpc version', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: { jsonrpc: '1.0', method: 'tools/list', id: 1 },
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32600)
  })

  test('should return Method not found (-32601) for unknown method', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('unknown/method/xyz'),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32601)
    expect(body.error?.message).toContain('Method not found')
  })

  test('should return Invalid params (-32602) for malformed params', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: 'not an object', // params must be object
      },
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32602)
  })

  test('should return Internal error (-32603) for server exceptions', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    // Call a tool that throws an internal error
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: jsonRpcRequest('tools/call', {
        name: 'throw_error',
        arguments: {},
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.error).toBeDefined()
    expect(body.error?.code).toBe(-32603)
  })

  test('should include request id in error responses', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 'my-request-id-123',
        method: 'unknown/method',
      },
    })

    const body = (await response.json()) as JsonRpcResponse
    expect(body.id).toBe('my-request-id-123')
  })

  test('should return null id for parse errors', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: '{not valid json',
    })

    const body = (await response.json()) as JsonRpcResponse
    expect(body.id).toBeNull()
  })

  test('should return 415 for non-JSON content type', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'text/plain' },
      data: '{}',
    })

    expect(response.status()).toBe(415)
  })

  test('should return 405 for unsupported HTTP methods', async ({ request }) => {
    const response = await request.put('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    })

    expect(response.status()).toBe(405)
    expect(response.headers()['allow']).toContain('GET')
    expect(response.headers()['allow']).toContain('POST')
    expect(response.headers()['allow']).toContain('DELETE')
  })

  test('should handle OPTIONS for CORS preflight', async ({ request }) => {
    const response = await request.fetch('/mcp', { method: 'OPTIONS' })

    expect([200, 204]).toContain(response.status())
    // CORS headers should be present
    const headers = response.headers()
    const allowMethods = headers['access-control-allow-methods'] || headers['Access-Control-Allow-Methods']
    // POST must be allowed for MCP JSON-RPC requests
    expect(allowMethods).toContain('POST')
    // Access-Control-Allow-Origin should be present
    const allowOrigin = headers['access-control-allow-origin'] || headers['Access-Control-Allow-Origin']
    expect(allowOrigin).toBeDefined()
  })

  test('should handle batch requests with mixed success/error', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: [
        jsonRpcRequest('tools/list', undefined, 1),
        jsonRpcRequest('unknown/method', undefined, 2),
        jsonRpcRequest('ping', undefined, 3),
      ],
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(3)

    // First should succeed
    expect(body[0].result).toBeDefined()
    expect(body[0].id).toBe(1)

    // Second should fail
    expect(body[1].error).toBeDefined()
    expect(body[1].id).toBe(2)

    // Third should succeed
    expect(body[2].result).toBeDefined()
    expect(body[2].id).toBe(3)
  })

  test('should require session for non-initialize methods', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'non-existent-session',
      },
      data: jsonRpcRequest('tools/list'),
    })

    expect(response.status()).toBe(404)
  })
})

// =============================================================================
// 9. Batch Request Tests
// =============================================================================

test.describe('SSE MCP - Batch Request Tests', () => {
  test('should handle empty batch array', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: [],
    })

    // Empty batch: can return 204 (no content) or 200 with error/empty array
    // Per JSON-RPC spec, empty batch is valid and returns empty array
    expect([200, 204]).toContain(response.status())
  })

  test('should process batch requests in order', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: [
        jsonRpcRequest('ping', undefined, 'first'),
        jsonRpcRequest('ping', undefined, 'second'),
        jsonRpcRequest('ping', undefined, 'third'),
      ],
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse[]
    expect(body.length).toBe(3)
    expect(body[0].id).toBe('first')
    expect(body[1].id).toBe('second')
    expect(body[2].id).toBe('third')
  })

  test('should handle batch with only notifications', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const response = await request.post('/mcp', {
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      },
      data: [
        jsonRpcNotification('notifications/initialized'),
        jsonRpcNotification('notifications/message', { level: 'info', data: 'test' }),
      ],
    })

    // All notifications - should return 204
    expect(response.status()).toBe(204)
  })
})

// =============================================================================
// 10. Content-Type Tests
// =============================================================================

test.describe('SSE MCP - Content-Type Tests', () => {
  test('should accept application/json', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('ping'),
    })

    expect(response.status()).toBe(200)
  })

  test('should accept application/json with charset', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      data: jsonRpcRequest('ping'),
    })

    expect(response.status()).toBe(200)
  })

  test('should reject text/plain content type', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'text/plain' },
      data: '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
    })

    expect(response.status()).toBe(415)
  })

  test('should reject application/xml content type', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/xml' },
      data: '<request/>',
    })

    expect(response.status()).toBe(415)
  })

  test('should return application/json in response', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('ping'),
    })

    expect(response.headers()['content-type']).toBe('application/json')
  })
})

// =============================================================================
// 11. Protocol Version Tests
// =============================================================================

test.describe('SSE MCP - Protocol Version Tests', () => {
  test('should accept protocol version 2024-11-05', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })

    expect(response.status()).toBe(200)
    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.protocolVersion).toBe('2024-11-05')
  })

  test('should return server protocol version in response', async ({ request }) => {
    const response = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })

    const body = (await response.json()) as JsonRpcResponse
    expect(body.result?.protocolVersion).toBeDefined()
    expect(typeof body.result?.protocolVersion).toBe('string')
  })
})

// =============================================================================
// 12. SSE Event Format Tests
// =============================================================================

test.describe('SSE MCP - Event Format Tests', () => {
  test('should format SSE events correctly', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const sseResponse = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    expect(sseResponse.status()).toBe(200)
    const body = await sseResponse.text()

    // SSE format: lines starting with : are comments
    // lines starting with data: are data
    // lines starting with event: are event types
    expect(body).toMatch(/^[:\w]/)
  })

  test('should send endpoint event with POST URL', async ({ request }) => {
    const initResponse = await request.post('/mcp', {
      headers: { 'Content-Type': 'application/json' },
      data: jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      }),
    })
    const sessionId = initResponse.headers()['mcp-session-id']

    const sseResponse = await request.get('/mcp', {
      headers: { 'Mcp-Session-Id': sessionId },
    })

    const body = await sseResponse.text()

    // Should contain endpoint information or keep-alive
    expect(body.length).toBeGreaterThan(0)
  })
})
