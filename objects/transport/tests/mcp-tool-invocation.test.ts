/**
 * MCP Tool Invocation with Graph Tracking Tests - TDD RED Phase
 *
 * Tests for MCP tools/call that creates invocation relationships and returns MCPToolResult.
 *
 * Requirements:
 * 1. Tool Call with Tracking - creates invocation relationship, returns MCPToolResult format
 * 2. Error Handling - sets isError on failure, records error in relationship
 * 3. Executor Tracking - records session as executor, links to Agent/Human Thing
 *
 * These tests use real MCP JSON-RPC requests and real tool execution (no mocks for business logic).
 * RED phase - tests should FAIL until implementation is complete.
 *
 * The invocation tracking feature should:
 * - Create a relationship record with verb='invoked' when tools/call is processed
 * - Store input, output, error, duration, and executor info in the relationship data
 * - Link from session/executor to the tool Thing ($id/tools/{toolName})
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DO, type Env } from '../../DO'

// Type for relationship records (matches db/relationships.ts)
interface Relationship {
  id: string
  verb: string
  from: string
  to: string
  data: unknown
  createdAt: Date
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    setAlarm: vi.fn(async (_time: number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): { toString: () => string; equals: (other: unknown) => boolean; name: string } {
  return {
    toString: () => name,
    equals: (other: unknown) => (other as { toString: () => string })?.toString?.() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'test-do-id') {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

// ============================================================================
// JSON-RPC 2.0 TYPES
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// Standard JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
}

// ============================================================================
// MCP TOOL RESULT TYPE (per MCP spec)
// ============================================================================

interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

// ============================================================================
// INVOCATION RELATIONSHIP DATA
// ============================================================================

interface InvocationData {
  input: Record<string, unknown>
  output?: unknown
  error?: string
  duration?: number
  startedAt: string
  completedAt?: string
  executor?: {
    sessionId: string
    type: 'agent' | 'human' | 'unknown'
    thingId?: string // $id of Agent or Human Thing
  }
}

// ============================================================================
// TEST DO WITH MCP TOOLS
// ============================================================================

// ============================================================================
// INVOCATION STORE (captures relationships created during tool calls)
// ============================================================================

/**
 * Global store for invocation relationships created during tests.
 * In the real implementation, these would be persisted in the relationships table.
 * Tests verify that the MCP handler creates these records.
 */
const invocationStore: Relationship[] = []

function clearInvocationStore(): void {
  invocationStore.length = 0
}

function getInvocationsForTool(ns: string, toolName: string): Relationship[] {
  const toolId = `${ns}/tools/${toolName}`
  return invocationStore.filter(r => r.to === toolId && r.verb === 'invoked')
}

/**
 * Test DO with MCP tools that support invocation tracking
 *
 * The MCP handler (to be implemented) should:
 * 1. Before executing the tool, create an invocation relationship with startedAt
 * 2. Execute the tool
 * 3. Update the relationship with output/error, duration, completedAt
 *
 * The relationship should be stored in the DO's relationships table with:
 * - verb: 'invoked'
 * - from: session URL or executor Thing $id
 * - to: tool Thing URL (ns/tools/toolName)
 * - data: InvocationData (input, output, error, duration, executor, timestamps)
 */
class InvocationTrackingDO extends DO {
  static $mcp = {
    tools: {
      sendEmail: {
        description: 'Send an email',
        inputSchema: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' },
        },
        required: ['to', 'subject'],
      },
      parseJson: {
        description: 'Parse a JSON string',
        inputSchema: {
          text: { type: 'string', description: 'JSON text to parse' },
        },
        required: ['text'],
      },
      failingTool: {
        description: 'A tool that always fails',
        inputSchema: {},
      },
      conditionalTool: {
        description: 'A tool that fails based on input',
        inputSchema: {
          shouldFail: { type: 'boolean', description: 'Whether to fail' },
          message: { type: 'string', description: 'Message to return' },
        },
        required: ['shouldFail'],
      },
    },
    resources: ['invocations'],
  }

  // Simulated email sending
  sendEmail(to: string, subject: string, body?: string): { messageId: string; to: string; subject: string } {
    if (!to.includes('@')) {
      throw new Error('Invalid email address')
    }
    return {
      messageId: crypto.randomUUID(),
      to,
      subject,
    }
  }

  // JSON parsing tool
  parseJson(text: string): unknown {
    return JSON.parse(text)
  }

  // Always failing tool
  failingTool(): never {
    throw new Error('This tool always fails')
  }

  // Conditionally failing tool
  conditionalTool(shouldFail: boolean, message?: string): { success: boolean; message: string } {
    if (shouldFail) {
      throw new Error(message || 'Conditional failure')
    }
    return { success: true, message: message || 'Success' }
  }

  /**
   * Get invocation relationships for a specific tool.
   *
   * In the full implementation, this queries the relationships table.
   * For RED phase tests, we expect this to be implemented as part of the feature.
   *
   * Expected implementation in mcp-server.ts tools/call handler:
   * 1. Create relationship: { verb: 'invoked', from: sessionUrl, to: toolUrl, data: {...} }
   * 2. Execute tool
   * 3. Update relationship with result
   */
  async getToolInvocations(toolName: string): Promise<Relationship[]> {
    // This method needs to be implemented to query the relationships table
    // For now, it will throw to indicate the feature is not yet implemented
    // The implementation should query: SELECT * FROM relationships WHERE to = ? AND verb = 'invoked'

    // Access the db to query relationships - this is the expected interface
    const toolId = `${this.ns}/tools/${toolName}`

    // Try to access relationships via the DO's graph/relationship API
    // This will fail until the feature is implemented
    if (typeof (this as unknown as { getRelationshipsTo: unknown }).getRelationshipsTo === 'function') {
      return (this as unknown as { getRelationshipsTo: (id: string, verb: string) => Promise<Relationship[]> })
        .getRelationshipsTo(toolId, 'invoked')
    }

    // Fallback: try to query the db directly if available
    if (this.db) {
      const rows = this.db.exec(
        `SELECT * FROM relationships WHERE "to" = ? AND verb = 'invoked' ORDER BY created_at DESC`,
        toolId
      ).toArray()
      return rows as unknown as Relationship[]
    }

    throw new Error('Invocation tracking not implemented - getToolInvocations requires relationship storage')
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a JSON-RPC request
 */
function createJsonRpcRequest(
  method: string,
  params?: unknown,
  id: string | number = 1
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  }
}

/**
 * Create an HTTP request for MCP
 */
function createMcpRequest(
  jsonRpcRequest: JsonRpcRequest | JsonRpcRequest[],
  sessionId?: string,
  headers?: Record<string, string>
): Request {
  const allHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }
  if (sessionId) {
    allHeaders['Mcp-Session-Id'] = sessionId
  }

  return new Request('https://test.do/mcp', {
    method: 'POST',
    headers: allHeaders,
    body: JSON.stringify(jsonRpcRequest),
  })
}

/**
 * Parse a JSON-RPC response from an HTTP response
 */
async function parseResponse(response: Response): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  const text = await response.text()
  return JSON.parse(text)
}

/**
 * Initialize session and return session ID
 */
async function initializeSession(doInstance: DO): Promise<string> {
  const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
  const initReq = createMcpRequest(createJsonRpcRequest('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'test-client', version: '1.0.0' },
  }))
  const initRes = await handleMcp.call(doInstance, initReq)
  return initRes.headers.get('Mcp-Session-Id')!
}

// ============================================================================
// TESTS: MCP TOOL INVOCATION WITH TRACKING
// ============================================================================

describe('MCP Tool Invocation with Graph Tracking', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: Env
  let doInstance: InvocationTrackingDO
  let sessionId: string

  beforeEach(async () => {
    // Clear any previous invocation records
    clearInvocationStore()

    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new InvocationTrackingDO(mockState as unknown as DurableObjectState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com' })

    // Initialize MCP session
    sessionId = await initializeSession(doInstance)
  })

  // ==========================================================================
  // 1. TOOL CALL WITH TRACKING
  // ==========================================================================

  describe('Tool Call with Tracking', () => {
    it('creates invocation relationship on tools/call', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      // Verify invocation relationship was created
      const invocations = await doInstance.getToolInvocations('sendEmail')
      expect(invocations).toHaveLength(1)
      expect(invocations[0].verb).toBe('invoked')
    })

    it('records input arguments in invocation relationship', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test Subject', body: 'Hello!' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      expect(invocations).toHaveLength(1)

      const data = invocations[0].data as InvocationData
      expect(data.input).toMatchObject({
        to: 'test@example.com',
        subject: 'Test Subject',
        body: 'Hello!',
      })
    })

    it('records output in invocation relationship on success', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      const data = invocations[0].data as InvocationData

      expect(data.output).toBeDefined()
      expect((data.output as { messageId: string }).messageId).toBeDefined()
      expect((data.output as { to: string }).to).toBe('test@example.com')
    })

    it('records duration in invocation relationship', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"key": "value"}' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('parseJson')
      const data = invocations[0].data as InvocationData

      expect(data.duration).toBeDefined()
      expect(typeof data.duration).toBe('number')
      expect(data.duration).toBeGreaterThanOrEqual(0)
    })

    it('records startedAt and completedAt timestamps', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const beforeCall = new Date().toISOString()

      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"key": "value"}' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const afterCall = new Date().toISOString()
      const invocations = await doInstance.getToolInvocations('parseJson')
      const data = invocations[0].data as InvocationData

      expect(data.startedAt).toBeDefined()
      expect(data.completedAt).toBeDefined()
      expect(new Date(data.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(beforeCall).getTime())
      expect(new Date(data.completedAt!).getTime()).toBeLessThanOrEqual(new Date(afterCall).getTime())
    })

    it('returns MCPToolResult format with content array', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"key": "value"}' },
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as MCPToolResult

      expect(result.content).toBeDefined()
      expect(Array.isArray(result.content)).toBe(true)
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0].type).toBe('text')
    })

    it('links invocation from tool Thing to caller', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      expect(invocations[0].to).toContain('sendEmail')
      expect(invocations[0].from).toBeDefined()
    })

    it('tracks multiple invocations of the same tool', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // First invocation
      const request1 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"first": true}' },
        }, 1),
        sessionId
      )
      await handleMcp.call(doInstance, request1)

      // Second invocation
      const request2 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"second": true}' },
        }, 2),
        sessionId
      )
      await handleMcp.call(doInstance, request2)

      const invocations = await doInstance.getToolInvocations('parseJson')
      expect(invocations).toHaveLength(2)

      // Verify different inputs were recorded
      const inputs = invocations.map(inv => (inv.data as InvocationData).input)
      expect(inputs).toContainEqual({ text: '{"first": true}' })
      expect(inputs).toContainEqual({ text: '{"second": true}' })
    })
  })

  // ==========================================================================
  // 2. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('sets isError on tool failure', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'failingTool',
          arguments: {},
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as MCPToolResult
      expect(result.isError).toBe(true)
    })

    it('records error message in relationship on failure', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'failingTool',
          arguments: {},
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('failingTool')
      expect(invocations).toHaveLength(1)

      const data = invocations[0].data as InvocationData
      expect(data.error).toBeDefined()
      expect(data.error).toContain('This tool always fails')
    })

    it('records error in relationship for validation failures', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'invalid-email', subject: 'Test' }, // Invalid email format
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      expect(invocations).toHaveLength(1)

      const data = invocations[0].data as InvocationData
      expect(data.error).toBeDefined()
      expect(data.error).toContain('Invalid email')
    })

    it('returns error content in MCPToolResult format', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'conditionalTool',
          arguments: { shouldFail: true, message: 'Custom error message' },
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as MCPToolResult
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Custom error message')
    })

    it('still records completedAt on failure', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'failingTool',
          arguments: {},
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('failingTool')
      const data = invocations[0].data as InvocationData

      expect(data.startedAt).toBeDefined()
      expect(data.completedAt).toBeDefined()
    })

    it('does not record output on failure', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'failingTool',
          arguments: {},
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('failingTool')
      const data = invocations[0].data as InvocationData

      expect(data.output).toBeUndefined()
      expect(data.error).toBeDefined()
    })
  })

  // ==========================================================================
  // 3. EXECUTOR TRACKING
  // ==========================================================================

  describe('Executor Tracking', () => {
    it('records session as executor', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      const data = invocations[0].data as InvocationData

      expect(data.executor).toBeDefined()
      expect(data.executor!.sessionId).toBe(sessionId)
    })

    it('invocation from field contains session reference', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{}' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('parseJson')

      // The 'from' field should reference the session
      expect(invocations[0].from).toContain(sessionId)
    })

    it('links invocation to Agent Thing when provided', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // Provide agent Thing ID in request headers
      const agentThingId = 'https://agents.do/priya'
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test' },
        }),
        sessionId,
        { 'X-Agent-Thing-Id': agentThingId }
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      const data = invocations[0].data as InvocationData

      expect(data.executor).toBeDefined()
      expect(data.executor!.type).toBe('agent')
      expect(data.executor!.thingId).toBe(agentThingId)
    })

    it('links invocation to Human Thing when provided', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // Provide human Thing ID in request headers
      const humanThingId = 'https://id.org.ai/nathan'
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'test@example.com', subject: 'Test' },
        }),
        sessionId,
        { 'X-Human-Thing-Id': humanThingId }
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('sendEmail')
      const data = invocations[0].data as InvocationData

      expect(data.executor).toBeDefined()
      expect(data.executor!.type).toBe('human')
      expect(data.executor!.thingId).toBe(humanThingId)
    })

    it('marks executor type as unknown when no Thing ID provided', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{}' },
        }),
        sessionId
      )

      await handleMcp.call(doInstance, request)

      const invocations = await doInstance.getToolInvocations('parseJson')
      const data = invocations[0].data as InvocationData

      expect(data.executor).toBeDefined()
      expect(data.executor!.type).toBe('unknown')
      expect(data.executor!.thingId).toBeUndefined()
    })

    it('different sessions create distinct invocation records', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // First session invocation
      const request1 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"session": 1}' },
        }, 1),
        sessionId
      )
      await handleMcp.call(doInstance, request1)

      // Create second session
      const sessionId2 = await initializeSession(doInstance)

      // Second session invocation
      const request2 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'parseJson',
          arguments: { text: '{"session": 2}' },
        }, 2),
        sessionId2
      )
      await handleMcp.call(doInstance, request2)

      const invocations = await doInstance.getToolInvocations('parseJson')
      expect(invocations).toHaveLength(2)

      const executors = invocations.map(inv => (inv.data as InvocationData).executor?.sessionId)
      expect(executors).toContain(sessionId)
      expect(executors).toContain(sessionId2)
    })
  })

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Full Integration', () => {
    it('complete tool call flow with tracking', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const agentThingId = 'https://agents.do/ralph'

      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'sendEmail',
          arguments: { to: 'user@example.com', subject: 'Hello', body: 'World' },
        }),
        sessionId,
        { 'X-Agent-Thing-Id': agentThingId }
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      // Verify response format
      expect(json.jsonrpc).toBe('2.0')
      expect(json.result).toBeDefined()
      const result = json.result as MCPToolResult
      expect(result.content).toBeDefined()
      expect(result.isError).toBeUndefined()

      // Verify invocation was tracked
      const invocations = await doInstance.getToolInvocations('sendEmail')
      expect(invocations).toHaveLength(1)

      const data = invocations[0].data as InvocationData

      // Verify all tracking fields
      expect(data.input).toMatchObject({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
      })
      expect(data.output).toBeDefined()
      expect(data.error).toBeUndefined()
      expect(data.duration).toBeGreaterThanOrEqual(0)
      expect(data.startedAt).toBeDefined()
      expect(data.completedAt).toBeDefined()
      expect(data.executor).toMatchObject({
        sessionId,
        type: 'agent',
        thingId: agentThingId,
      })
    })

    it('complete error flow with tracking', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const humanThingId = 'https://id.org.ai/tester'

      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'conditionalTool',
          arguments: { shouldFail: true, message: 'Integration test failure' },
        }),
        sessionId,
        { 'X-Human-Thing-Id': humanThingId }
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      // Verify error response format
      const result = json.result as MCPToolResult
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Integration test failure')

      // Verify invocation was tracked
      const invocations = await doInstance.getToolInvocations('conditionalTool')
      expect(invocations).toHaveLength(1)

      const data = invocations[0].data as InvocationData

      // Verify error tracking
      expect(data.input).toMatchObject({ shouldFail: true, message: 'Integration test failure' })
      expect(data.output).toBeUndefined()
      expect(data.error).toContain('Integration test failure')
      expect(data.executor).toMatchObject({
        sessionId,
        type: 'human',
        thingId: humanThingId,
      })
    })
  })
})
