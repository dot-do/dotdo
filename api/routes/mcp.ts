import { Hono } from 'hono'
import type { Env } from '../index'

/**
 * MCP HTTP Streamable Transport Handler
 *
 * Implements JSON-RPC 2.0 over HTTP with SSE for server-initiated notifications.
 *
 * Routes:
 * - POST /mcp: Handle JSON-RPC requests
 * - GET /mcp: SSE stream for server-initiated notifications
 * - DELETE /mcp: Terminate session
 */

// Session storage (in-memory for now, should use DO in production)
const sessions = new Map<string, McpSession>()

export interface McpSession {
  id: string
  createdAt: Date
  lastActivity: Date
  tools: Map<string, McpTool>
  resources: Map<string, McpResource>
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export function createMcpSession(): McpSession {
  const id = crypto.randomUUID()
  const session: McpSession = {
    id,
    createdAt: new Date(),
    lastActivity: new Date(),
    tools: new Map(),
    resources: new Map(),
  }
  sessions.set(id, session)
  return session
}

export function getMcpSession(sessionId: string): McpSession | undefined {
  return sessions.get(sessionId)
}

export function deleteMcpSession(sessionId: string): boolean {
  return sessions.delete(sessionId)
}

// Standard JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  }
}

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

export async function handleMcpRequest(request: Request, session?: McpSession): Promise<Response> {
  const method = request.method

  // GET: SSE stream for notifications
  if (method === 'GET') {
    const sessionId = request.headers.get('mcp-session-id')
    if (!sessionId) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing mcp-session-id header')), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const existingSession = getMcpSession(sessionId)
    if (!existingSession) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid session')), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Return SSE stream
    const stream = new ReadableStream({
      start(controller) {
        // Send initial ping
        controller.enqueue(new TextEncoder().encode('event: ping\ndata: {}\n\n'))
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'mcp-session-id': sessionId,
      },
    })
  }

  // DELETE: Terminate session
  if (method === 'DELETE') {
    const sessionId = request.headers.get('mcp-session-id')
    if (!sessionId) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing mcp-session-id header')), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const deleted = deleteMcpSession(sessionId)
    if (!deleted) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found')), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(null, { status: 204 })
  }

  // POST: Handle JSON-RPC requests
  if (method !== 'POST') {
    return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Method not allowed')), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await request.json() as JsonRpcRequest | JsonRpcRequest[]
  } catch {
    return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error')), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get or create session
  let sessionId = request.headers.get('mcp-session-id')
  let currentSession = sessionId ? getMcpSession(sessionId) : undefined

  // Handle batch requests
  const requests = Array.isArray(body) ? body : [body]
  const responses: JsonRpcResponse[] = []
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  for (const req of requests) {
    // Validate JSON-RPC format
    if (req.jsonrpc !== '2.0') {
      responses.push(jsonRpcError(req.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC version'))
      continue
    }

    // Notifications have no id - no response expected
    if (req.id === undefined) {
      // Process notification but don't add to responses
      continue
    }

    // Handle MCP methods
    switch (req.method) {
      case 'initialize': {
        if (!currentSession) {
          currentSession = createMcpSession()
          sessionId = currentSession.id
        }
        responseHeaders['mcp-session-id'] = currentSession.id
        responses.push(jsonRpcSuccess(req.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            prompts: { listChanged: true },
          },
          serverInfo: {
            name: 'dotdo-mcp',
            version: '0.1.0',
          },
        }))
        break
      }

      case 'tools/list': {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not initialized'))
          continue
        }
        responses.push(jsonRpcSuccess(req.id, {
          tools: Array.from(currentSession.tools.values()),
        }))
        break
      }

      case 'tools/call': {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not initialized'))
          continue
        }
        const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined
        if (!params?.name) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing tool name'))
          continue
        }
        const tool = currentSession.tools.get(params.name)
        if (!tool) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Tool not found: ${params.name}`))
          continue
        }
        // TODO: Execute tool
        responses.push(jsonRpcSuccess(req.id, {
          content: [{ type: 'text', text: 'Tool executed' }],
        }))
        break
      }

      case 'resources/list': {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not initialized'))
          continue
        }
        responses.push(jsonRpcSuccess(req.id, {
          resources: Array.from(currentSession.resources.values()),
        }))
        break
      }

      case 'resources/read': {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not initialized'))
          continue
        }
        const params = req.params as { uri: string } | undefined
        if (!params?.uri) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing resource URI'))
          continue
        }
        responses.push(jsonRpcSuccess(req.id, {
          contents: [{ uri: params.uri, mimeType: 'text/plain', text: '' }],
        }))
        break
      }

      case 'ping': {
        responses.push(jsonRpcSuccess(req.id, {}))
        break
      }

      default:
        responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${req.method}`))
    }
  }

  // Return single response or batch
  const responseBody = Array.isArray(body) ? responses : responses[0]
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: responseHeaders,
  })
}

// Hono route handler
export const mcpRoutes = new Hono<{ Bindings: Env }>()

mcpRoutes.all('/', async (c) => {
  const response = await handleMcpRequest(c.req.raw)
  return response
})

export default mcpRoutes
