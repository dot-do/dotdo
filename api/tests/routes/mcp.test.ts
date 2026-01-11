import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Type for JSON-RPC responses
interface JsonRpcResponse {
  jsonrpc: string
  id: number | string | null
  result?: {
    protocolVersion?: string
    serverInfo?: { name: string; version?: string }
    capabilities?: Record<string, unknown>
    tools?: unknown[]
    resources?: unknown[]
    contents?: unknown[]
    prompts?: unknown[]
    messages?: unknown[]
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
  }
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// Type for batch responses
type JsonRpcBatchResponse = JsonRpcResponse[]

/**
 * RED Phase Tests for MCP HTTP Streamable Transport
 *
 * These tests define the expected behavior of the MCP server routes.
 * They will FAIL until the implementation is created in worker/routes/mcp.ts
 *
 * MCP Streamable HTTP Transport Specification:
 * - POST /mcp: Handle JSON-RPC requests
 * - GET /mcp: SSE stream for server-initiated notifications
 * - DELETE /mcp: Terminate session
 * - Mcp-Session-Id header: Session management
 *
 * JSON-RPC 2.0 Format:
 * - Request: { jsonrpc: "2.0", id: string|number, method: string, params?: object }
 * - Response: { jsonrpc: "2.0", id: string|number, result?: any, error?: { code: number, message: string, data?: any } }
 * - Notification: { jsonrpc: "2.0", method: string, params?: object } (no id, no response)
 */

// Import the MCP route handler
import { handleMcpRequest, McpSession, createMcpSession } from '../../routes/mcp'

// Mock request helper
function createRequest(
  method: string,
  path: string,
  options?: {
    body?: unknown
    headers?: Record<string, string>
  },
): Request {
  const url = `https://example.com.ai${path}`
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }
  if (options?.body) {
    init.body = JSON.stringify(options.body)
  }
  return new Request(url, init)
}

// JSON-RPC request builders
function jsonRpcRequest(method: string, params?: unknown, id: string | number = 1) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method,
    params,
  }
}

function jsonRpcNotification(method: string, params?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    method,
    params,
  }
}

describe('MCP HTTP Streamable Transport Routes', () => {
  describe('POST /mcp - JSON-RPC Request Handler', () => {
    it('accepts valid JSON-RPC initialize request', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result).toBeDefined()
      expect(body.result!.protocolVersion).toBe('2024-11-05')
      expect(body.result!.serverInfo).toBeDefined()
      expect(body.result!.serverInfo!.name).toBe('dotdo-mcp-server')
    })

    it('returns Mcp-Session-Id header on successful initialize', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })

      const response = await handleMcpRequest(request)

      expect(response.headers.get('Mcp-Session-Id')).toBeDefined()
      expect(response.headers.get('Mcp-Session-Id')).toMatch(/^[a-zA-Z0-9-]+$/)
    })

    it('accepts tools/list request', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/list'),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result!.tools).toBeDefined()
      expect(Array.isArray(body.result!.tools)).toBe(true)
    })

    it('accepts tools/call request and returns result', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', {
          name: 'echo',
          arguments: { message: 'hello' },
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result!.content).toBeDefined()
      expect(Array.isArray(body.result!.content)).toBe(true)
    })

    it('accepts resources/list request', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('resources/list'),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result!.resources).toBeDefined()
      expect(Array.isArray(body.result!.resources)).toBe(true)
    })

    it('accepts resources/read request', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('resources/read', {
          uri: 'dotdo://things/startup/acme',
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result!.contents).toBeDefined()
      expect(Array.isArray(body.result!.contents)).toBe(true)
    })

    it('accepts prompts/list request', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('prompts/list'),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result!.prompts).toBeDefined()
      expect(Array.isArray(body.result!.prompts)).toBe(true)
    })

    it('accepts prompts/get request', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('prompts/get', {
          name: 'summarize',
          arguments: { content: 'test content' },
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result!.messages).toBeDefined()
      expect(Array.isArray(body.result!.messages)).toBe(true)
    })

    it('handles batch requests', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: [jsonRpcRequest('tools/list', undefined, 1), jsonRpcRequest('resources/list', undefined, 2)],
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcBatchResponse
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(2)
      expect(body[0].id).toBe(1)
      expect(body[1].id).toBe(2)
    })

    it('handles notifications without response body', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcNotification('notifications/initialized'),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      // Notifications should return 204 No Content
      expect(response.status).toBe(204)
    })
  })

  describe('GET /mcp - SSE Stream for Notifications', () => {
    it('returns SSE stream with proper content type', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('GET', '/mcp', {
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(response.headers.get('Connection')).toBe('keep-alive')
    })

    it('requires Mcp-Session-Id header for SSE stream', async () => {
      const request = createRequest('GET', '/mcp')

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32600) // Invalid Request
      expect(body.error!.message).toContain('Mcp-Session-Id')
    })

    it('returns 404 for non-existent session', async () => {
      const request = createRequest('GET', '/mcp', {
        headers: { 'Mcp-Session-Id': 'non-existent-session' },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.message).toContain('Session not found')
    })

    it('SSE stream sends keep-alive comments', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('GET', '/mcp', {
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      // Read first chunk (should be keep-alive or initial event)
      const { value, done } = await reader.read()
      expect(done).toBe(false)

      const text = decoder.decode(value)
      // Should start with SSE comment or event
      expect(text.startsWith(':') || text.startsWith('event:')).toBe(true)

      reader.releaseLock()
    })
  })

  describe('DELETE /mcp - Session Termination', () => {
    it('terminates session and returns 204', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('DELETE', '/mcp', {
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(204)
    })

    it('requires Mcp-Session-Id header', async () => {
      const request = createRequest('DELETE', '/mcp')

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32600)
    })

    it('returns 404 for non-existent session', async () => {
      const request = createRequest('DELETE', '/mcp', {
        headers: { 'Mcp-Session-Id': 'non-existent-session' },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(404)
    })

    it('subsequent requests to deleted session fail', async () => {
      // First, create a session
      const initRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })
      const initResponse = await handleMcpRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      // Delete the session
      const deleteRequest = createRequest('DELETE', '/mcp', {
        headers: { 'Mcp-Session-Id': sessionId },
      })
      await handleMcpRequest(deleteRequest)

      // Try to use the deleted session
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/list'),
        headers: { 'Mcp-Session-Id': sessionId },
      })
      const response = await handleMcpRequest(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Mcp-Session-Id Header - Session Management', () => {
    it('creates new session when no session id provided on initialize', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })

      const response = await handleMcpRequest(request)
      const sessionId = response.headers.get('Mcp-Session-Id')

      expect(sessionId).toBeDefined()
      expect(sessionId!.length).toBeGreaterThan(0)
    })

    it('retrieves existing session when valid session id provided', async () => {
      // Create session
      const initRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })
      const initResponse = await handleMcpRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      // Use session
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/list'),
        headers: { 'Mcp-Session-Id': sessionId },
      })
      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      // Session ID should be echoed back
      expect(response.headers.get('Mcp-Session-Id')).toBe(sessionId)
    })

    it('rejects requests with invalid session id (except initialize)', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/list'),
        headers: { 'Mcp-Session-Id': 'invalid-session-id' },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.message).toContain('Session not found')
    })

    it('allows initialize without session id', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
    })
  })

  describe('Tool Invocation - Results', () => {
    it('executes tool and returns typed content', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', {
          name: 'create_thing',
          arguments: {
            type: 'Startup',
            data: { name: 'Acme Corp', status: 'active' },
          },
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.result).toBeDefined()
      expect(body.result!.content).toBeDefined()
      expect(body.result!.content!.length).toBeGreaterThan(0)
      expect(body.result!.content![0].type).toBe('text')
    })

    it('returns tool error for invalid tool name', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', {
          name: 'non_existent_tool',
          arguments: {},
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200) // JSON-RPC errors are 200 with error object
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32601) // Method not found
    })

    it('returns tool error for invalid arguments', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', {
          name: 'create_thing',
          arguments: { invalid: 'missing required fields' },
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32602) // Invalid params
    })

    it('tool result includes isError flag on failure', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', {
          name: 'delete_thing',
          arguments: { id: 'non-existent-id' },
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      // Tool execution errors return result with isError
      expect(body.result).toBeDefined()
      expect(body.result!.isError).toBe(true)
      expect(body.result!.content![0].type).toBe('text')
    })
  })

  describe('JSON-RPC Error Handling', () => {
    it('returns Parse error for invalid JSON', async () => {
      const request = new Request('https://example.com.ai/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200) // JSON-RPC errors use 200
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32700) // Parse error
      expect(body.error!.message).toContain('Parse error')
    })

    it('returns Invalid Request for missing jsonrpc field', async () => {
      const request = createRequest('POST', '/mcp', {
        body: { method: 'tools/list' }, // missing jsonrpc
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32600) // Invalid Request
    })

    it('returns Invalid Request for wrong jsonrpc version', async () => {
      const request = createRequest('POST', '/mcp', {
        body: { jsonrpc: '1.0', method: 'tools/list', id: 1 },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32600)
    })

    it('returns Method not found for unknown method', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('unknown/method'),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32601) // Method not found
      expect(body.error!.message).toContain('Method not found')
    })

    it('returns Invalid params for malformed params', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', 'not an object'),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32602) // Invalid params
    })

    it('returns Internal error for server exceptions', async () => {
      const sessionId = 'test-session-1'
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/call', {
          name: 'throw_error', // Tool that throws internal error
          arguments: {},
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonRpcResponse
      expect(body.error).toBeDefined()
      expect(body.error!.code).toBe(-32603) // Internal error
    })

    it('error response includes request id', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('unknown/method', undefined, 'request-123'),
      })

      const response = await handleMcpRequest(request)

      const body = (await response.json()) as JsonRpcResponse
      expect(body.id).toBe('request-123')
    })

    it('error response has null id for unparseable request', async () => {
      const request = new Request('https://example.com.ai/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })

      const response = await handleMcpRequest(request)

      const body = (await response.json()) as JsonRpcResponse
      expect(body.id).toBeNull()
    })
  })

  describe('Session State Persistence', () => {
    it('persists client info across requests', async () => {
      // Initialize with client info
      const initRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'my-client', version: '2.0.0' },
        }),
      })
      const initResponse = await handleMcpRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      // Make subsequent request and verify session knows client
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('ping'),
        headers: { 'Mcp-Session-Id': sessionId },
      })
      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
      // Session should be retrieved (implementation detail tested via behavior)
    })

    it('persists capabilities negotiated during initialize', async () => {
      // Initialize with capabilities
      const initRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: { subscribe: true },
          },
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })
      const initResponse = await handleMcpRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      const initBody = (await initResponse.json()) as JsonRpcResponse
      expect(initBody.result?.capabilities).toBeDefined()

      // Verify capabilities are available in subsequent requests
      // (This tests that session stores the negotiated state)
      const subscribeRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('resources/subscribe', {
          uri: 'dotdo://things/startup/acme',
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })
      const subscribeResponse = await handleMcpRequest(subscribeRequest)

      // Should work because resources.subscribe was negotiated
      expect(subscribeResponse.status).toBe(200)
    })

    it('maintains separate state for different sessions', async () => {
      // Create first session
      const init1 = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'client-1', version: '1.0.0' },
        }),
      })
      const response1 = await handleMcpRequest(init1)
      const sessionId1 = response1.headers.get('Mcp-Session-Id')!

      // Create second session
      const init2 = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'client-2', version: '1.0.0' },
        }),
      })
      const response2 = await handleMcpRequest(init2)
      const sessionId2 = response2.headers.get('Mcp-Session-Id')!

      // Sessions should be different
      expect(sessionId1).not.toBe(sessionId2)

      // Each session should be independently accessible
      const req1 = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/list'),
        headers: { 'Mcp-Session-Id': sessionId1 },
      })
      const req2 = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('tools/list'),
        headers: { 'Mcp-Session-Id': sessionId2 },
      })

      const [res1, res2] = await Promise.all([handleMcpRequest(req1), handleMcpRequest(req2)])

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
    })

    it('session stores resource subscriptions', async () => {
      // Initialize
      const initRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { resources: { subscribe: true } },
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })
      const initResponse = await handleMcpRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      // Subscribe to a resource
      const subscribeRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('resources/subscribe', {
          uri: 'dotdo://things/startup/acme',
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })
      await handleMcpRequest(subscribeRequest)

      // Unsubscribe should work (proving subscription was stored)
      const unsubscribeRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('resources/unsubscribe', {
          uri: 'dotdo://things/startup/acme',
        }),
        headers: { 'Mcp-Session-Id': sessionId },
      })
      const unsubscribeResponse = await handleMcpRequest(unsubscribeRequest)

      expect(unsubscribeResponse.status).toBe(200)
    })

    it('session expires after inactivity', async () => {
      // This test verifies session TTL behavior
      // In practice, this would require time manipulation or short TTL

      const initRequest = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      })
      const initResponse = await handleMcpRequest(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      // Session should be valid initially
      expect(sessionId).toBeDefined()

      // Note: Actual expiration testing would require mocking time
      // This test documents the expected behavior
    })
  })

  describe('Session Creation Helper', () => {
    it('createMcpSession returns session with unique id', () => {
      const session1 = createMcpSession()
      const session2 = createMcpSession()

      expect(session1.id).toBeDefined()
      expect(session2.id).toBeDefined()
      expect(session1.id).not.toBe(session2.id)
    })

    it('session has required properties', () => {
      const session = createMcpSession()

      expect(session.id).toBeDefined()
      expect(session.createdAt).toBeInstanceOf(Date)
      expect(session.lastAccessedAt).toBeInstanceOf(Date)
      expect(session.clientInfo).toBeUndefined()
      expect(session.capabilities).toEqual({})
      expect(session.subscriptions).toEqual([])
    })

    it('session can store client info', () => {
      const session = createMcpSession()
      session.clientInfo = { name: 'test', version: '1.0' }

      expect(session.clientInfo).toEqual({ name: 'test', version: '1.0' })
    })
  })

  describe('HTTP Method Handling', () => {
    it('rejects PUT method', async () => {
      const request = createRequest('PUT', '/mcp', {
        body: jsonRpcRequest('tools/list'),
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toContain('GET')
      expect(response.headers.get('Allow')).toContain('POST')
      expect(response.headers.get('Allow')).toContain('DELETE')
    })

    it('rejects PATCH method', async () => {
      const request = createRequest('PATCH', '/mcp', {
        body: jsonRpcRequest('tools/list'),
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(405)
    })

    it('handles OPTIONS for CORS preflight', async () => {
      const request = createRequest('OPTIONS', '/mcp')

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Mcp-Session-Id')
    })
  })

  describe('Content-Type Handling', () => {
    it('accepts application/json content type', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
    })

    it('accepts application/json with charset', async () => {
      const request = createRequest('POST', '/mcp', {
        body: jsonRpcRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        }),
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(200)
    })

    it('rejects non-JSON content type for POST', async () => {
      const request = new Request('https://example.com.ai/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      })

      const response = await handleMcpRequest(request)

      expect(response.status).toBe(415) // Unsupported Media Type
    })
  })
})
