/**
 * MCP Server Integration Tests
 *
 * RED TDD: These tests verify that DO methods can be automatically exposed
 * as MCP tools. These tests are expected to FAIL initially because the
 * implementation does not exist yet.
 *
 * Key requirements tested:
 * 1. Methods decorated with @mcp() or defined in static $mcp config should be exposed as MCP tools
 * 2. Tool schemas should be auto-generated from method signatures/types
 * 3. tools/list should return all exposed DO methods
 * 4. tools/call should invoke the correct DO method
 * 5. Resources should map to DO data collections
 * 6. Proper JSON-RPC 2.0 compliance
 * 7. Session management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../../DO'

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
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
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
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-do-id'): DurableObjectState {
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
  } as unknown as DurableObjectState
}

/**
 * Create a mock environment with optional bindings
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
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
// MCP TOOL AND RESOURCE TYPES
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

interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

// ============================================================================
// TEST DO CLASSES
// ============================================================================

/**
 * Test DO with static $mcp configuration for tool exposure
 */
class McpTestDO extends DO {
  // Static MCP configuration for exposing tools
  static $mcp = {
    tools: {
      searchItems: {
        description: 'Search for items by query string',
        inputSchema: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Maximum results to return' },
        },
        required: ['query'],
      },
      createItem: {
        description: 'Create a new item',
        inputSchema: {
          name: { type: 'string', description: 'Item name' },
          data: { type: 'object', description: 'Item data' },
        },
        required: ['name'],
      },
      deleteItem: {
        description: 'Delete an item by ID',
        inputSchema: {
          id: { type: 'string', description: 'Item ID to delete' },
        },
        required: ['id'],
      },
      getStats: {
        description: 'Get statistics about the DO',
        inputSchema: {},
      },
    },
    resources: ['items', 'users', 'logs'],
  }

  // Simulated data store
  private _items: Array<{ id: string; name: string; data?: unknown }> = [
    { id: '1', name: 'First Item', data: { value: 100 } },
    { id: '2', name: 'Second Item', data: { value: 200 } },
  ]

  private _users: Array<{ id: string; username: string }> = [
    { id: 'u1', username: 'alice' },
    { id: 'u2', username: 'bob' },
  ]

  // MCP-exposed method implementations
  searchItems(query: string, limit?: number): Array<{ id: string; name: string }> {
    const results = this._items.filter((item) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    )
    return limit ? results.slice(0, limit) : results
  }

  createItem(name: string, data?: unknown): { id: string; name: string; data?: unknown } {
    const item = { id: crypto.randomUUID(), name, data }
    this._items.push(item)
    return item
  }

  deleteItem(id: string): { deleted: boolean; id: string } {
    const index = this._items.findIndex((item) => item.id === id)
    if (index >= 0) {
      this._items.splice(index, 1)
      return { deleted: true, id }
    }
    return { deleted: false, id }
  }

  getStats(): { itemCount: number; userCount: number } {
    return {
      itemCount: this._items.length,
      userCount: this._users.length,
    }
  }

  // Resource accessors
  getItems(): Array<{ id: string; name: string; data?: unknown }> {
    return this._items
  }

  getUsers(): Array<{ id: string; username: string }> {
    return this._users
  }

  getLogs(): string[] {
    return ['Log entry 1', 'Log entry 2']
  }
}

/**
 * Test DO with @mcp decorator pattern (to be implemented)
 */
class McpDecoratorTestDO extends DO {
  private _documents: Array<{ id: string; title: string; content: string }> = []

  // These methods should be decorated with @mcp() when the decorator is implemented
  // For now, we use a naming convention (_mcp_ prefix) to mark them for testing

  _mcp_createDocument(title: string, content: string): { id: string; title: string } {
    const doc = { id: crypto.randomUUID(), title, content }
    this._documents.push(doc)
    return { id: doc.id, title: doc.title }
  }

  _mcp_getDocument(id: string): { id: string; title: string; content: string } | null {
    return this._documents.find((doc) => doc.id === id) || null
  }

  _mcp_listDocuments(): Array<{ id: string; title: string }> {
    return this._documents.map((doc) => ({ id: doc.id, title: doc.title }))
  }

  _mcp_updateDocument(id: string, title?: string, content?: string): { updated: boolean } {
    const doc = this._documents.find((d) => d.id === id)
    if (doc) {
      if (title) doc.title = title
      if (content) doc.content = content
      return { updated: true }
    }
    return { updated: false }
  }
}

/**
 * Test DO with mixed methods (some MCP-exposed, some private)
 */
class MixedMethodsDO extends DO {
  static $mcp = {
    tools: {
      publicMethod: {
        description: 'A publicly exposed method',
        inputSchema: {
          value: { type: 'number' },
        },
      },
    },
  }

  publicMethod(value: number): { result: number } {
    return { result: value * 2 }
  }

  // This should NOT be exposed via MCP
  privateHelper(): string {
    return 'private'
  }

  // This should NOT be exposed via MCP
  protected internalMethod(): void {
    // Internal logic
  }
}

/**
 * Test DO with async methods
 */
class AsyncMethodsDO extends DO {
  static $mcp = {
    tools: {
      asyncFetch: {
        description: 'Fetch data asynchronously',
        inputSchema: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
      asyncProcess: {
        description: 'Process data with delay',
        inputSchema: {
          data: { type: 'object' },
          delay: { type: 'number' },
        },
      },
    },
  }

  async asyncFetch(url: string): Promise<{ status: string; url: string }> {
    // Simulated async operation
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { status: 'fetched', url }
  }

  async asyncProcess(data: unknown, delay?: number): Promise<{ processed: boolean }> {
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    return { processed: true }
  }
}

/**
 * Test DO with methods that throw errors
 */
class ErrorThrowingDO extends DO {
  static $mcp = {
    tools: {
      alwaysFails: {
        description: 'A method that always throws',
        inputSchema: {},
      },
      conditionalFail: {
        description: 'A method that fails based on input',
        inputSchema: {
          shouldFail: { type: 'boolean' },
        },
      },
    },
  }

  alwaysFails(): never {
    throw new Error('This method always fails')
  }

  conditionalFail(shouldFail: boolean): { success: boolean } {
    if (shouldFail) {
      throw new Error('Conditional failure triggered')
    }
    return { success: true }
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR TESTS
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
  sessionId?: string
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  return new Request('https://test.do/mcp', {
    method: 'POST',
    headers,
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

// ============================================================================
// TESTS: MCP CONFIGURATION
// ============================================================================

describe('MCP Server Integration', () => {
  describe('Static $mcp Configuration', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
    })

    it('DO class should have static $mcp property', () => {
      expect(McpTestDO.$mcp).toBeDefined()
      expect(typeof McpTestDO.$mcp).toBe('object')
    })

    it('$mcp.tools should define exposed methods', () => {
      expect(McpTestDO.$mcp.tools).toBeDefined()
      expect(Object.keys(McpTestDO.$mcp.tools)).toContain('searchItems')
      expect(Object.keys(McpTestDO.$mcp.tools)).toContain('createItem')
      expect(Object.keys(McpTestDO.$mcp.tools)).toContain('deleteItem')
      expect(Object.keys(McpTestDO.$mcp.tools)).toContain('getStats')
    })

    it('$mcp.resources should define exposed collections', () => {
      expect(McpTestDO.$mcp.resources).toBeDefined()
      expect(McpTestDO.$mcp.resources).toContain('items')
      expect(McpTestDO.$mcp.resources).toContain('users')
      expect(McpTestDO.$mcp.resources).toContain('logs')
    })

    it('tool configuration should include description', () => {
      const searchConfig = McpTestDO.$mcp.tools.searchItems
      expect(searchConfig.description).toBe('Search for items by query string')
    })

    it('tool configuration should include inputSchema', () => {
      const searchConfig = McpTestDO.$mcp.tools.searchItems
      expect(searchConfig.inputSchema).toBeDefined()
      expect(searchConfig.inputSchema.query).toEqual({
        type: 'string',
        description: 'The search query',
      })
    })

    it('tool configuration should include required fields', () => {
      const searchConfig = McpTestDO.$mcp.tools.searchItems
      expect(searchConfig.required).toContain('query')
    })
  })

  // ==========================================================================
  // TESTS: MCP TRANSPORT
  // ==========================================================================

  describe('MCP Transport (handleMcp method)', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    })

    it('DO should expose handleMcp method for MCP transport', () => {
      // This test will FAIL until handleMcp is implemented
      const handleMcp = (doInstance as unknown as { handleMcp?: Function }).handleMcp
      expect(handleMcp).toBeDefined()
      expect(typeof handleMcp).toBe('function')
    })

    it('handleMcp should accept HTTP Request and return Response', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))
      const response = await handleMcp.call(doInstance, request)

      expect(response).toBeInstanceOf(Response)
    })

    it('handleMcp should be routed from fetch on /mcp path', async () => {
      const request = new Request('https://test.example.com.ai/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createJsonRpcRequest('initialize')),
      })

      const response = await doInstance.fetch(request)

      // Should not be 404 - MCP endpoint should be registered
      expect(response.status).not.toBe(404)
    })
  })

  // ==========================================================================
  // TESTS: JSON-RPC 2.0 COMPLIANCE
  // ==========================================================================

  describe('JSON-RPC 2.0 Compliance', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    })

    it('response should include jsonrpc: "2.0"', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.jsonrpc).toBe('2.0')
    })

    it('response should echo back the request id', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize', {}, 42))
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.id).toBe(42)
    })

    it('should handle string request ids', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize', {}, 'request-uuid-123'))
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.id).toBe('request-uuid-123')
    })

    it('should return parse error for invalid JSON', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = new Request('https://test.do/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      })

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR)
    })

    it('should return invalid request for wrong jsonrpc version', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = new Request('https://test.do/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'test' }),
      })

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST)
    })

    it('should return method not found for unknown methods', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('unknown/method'))
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    })

    it('should handle batch requests', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const batch = [
        createJsonRpcRequest('ping', {}, 1),
        createJsonRpcRequest('ping', {}, 2),
        createJsonRpcRequest('ping', {}, 3),
      ]
      const request = createMcpRequest(batch)
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse[]

      expect(Array.isArray(json)).toBe(true)
      expect(json.length).toBe(3)
      expect(json.map((r) => r.id)).toEqual([1, 2, 3])
    })

    it('should handle notifications (no id) with 204 response', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = new Request('https://test.do/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message' }),
      })

      const response = await handleMcp.call(doInstance, request)

      expect(response.status).toBe(204)
    })
  })

  // ==========================================================================
  // TESTS: INITIALIZE METHOD
  // ==========================================================================

  describe('MCP Initialize', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    })

    it('should return protocol version on initialize', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as { protocolVersion: string }
      expect(result.protocolVersion).toBe('2024-11-05')
    })

    it('should return server info on initialize', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { serverInfo: { name: string; version: string } }
      expect(result.serverInfo).toBeDefined()
      expect(result.serverInfo.name).toBeDefined()
      expect(result.serverInfo.version).toBeDefined()
    })

    it('should return capabilities including tools', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { capabilities: { tools?: unknown } }
      expect(result.capabilities).toBeDefined()
      expect(result.capabilities.tools).toBeDefined()
    })

    it('should return capabilities including resources', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { capabilities: { resources?: unknown } }
      expect(result.capabilities.resources).toBeDefined()
    })

    it('should set Mcp-Session-Id header on initialize', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))

      const response = await handleMcp.call(doInstance, request)

      const sessionId = response.headers.get('Mcp-Session-Id')
      expect(sessionId).toBeDefined()
      expect(sessionId).not.toBe('')
    })
  })

  // ==========================================================================
  // TESTS: TOOLS/LIST
  // ==========================================================================

  describe('tools/list', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    })

    it('should return all tools defined in $mcp.tools', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // First initialize
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      const sessionId = initRes.headers.get('Mcp-Session-Id')!

      // Then list tools
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      expect(result.tools).toBeDefined()
      expect(Array.isArray(result.tools)).toBe(true)

      const toolNames = result.tools.map((t) => t.name)
      expect(toolNames).toContain('searchItems')
      expect(toolNames).toContain('createItem')
      expect(toolNames).toContain('deleteItem')
      expect(toolNames).toContain('getStats')
    })

    it('each tool should have proper JSON Schema inputSchema', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      const sessionId = initRes.headers.get('Mcp-Session-Id')!

      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const searchTool = result.tools.find((t) => t.name === 'searchItems')

      expect(searchTool).toBeDefined()
      expect(searchTool!.inputSchema.type).toBe('object')
      expect(searchTool!.inputSchema.properties).toBeDefined()
      expect(searchTool!.inputSchema.properties.query).toBeDefined()
      expect(searchTool!.inputSchema.properties.query.type).toBe('string')
      expect(searchTool!.inputSchema.required).toContain('query')
    })

    it('each tool should have a description', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      const sessionId = initRes.headers.get('Mcp-Session-Id')!

      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }

      for (const tool of result.tools) {
        expect(tool.description).toBeDefined()
        expect(typeof tool.description).toBe('string')
        expect(tool.description.length).toBeGreaterThan(0)
      }
    })

    it('should require session for tools/list', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.message).toContain('Session')
    })
  })

  // ==========================================================================
  // TESTS: TOOLS/CALL
  // ==========================================================================

  describe('tools/call', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      // Initialize session
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should invoke the correct DO method', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'searchItems',
          arguments: { query: 'First' },
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as { content: Array<{ type: string; text: string }> }
      expect(result.content).toBeDefined()
      expect(result.content[0].type).toBe('text')

      // The result should contain the search results
      const textContent = result.content[0].text
      expect(textContent).toContain('First Item')
    })

    it('should pass arguments to the method correctly', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'createItem',
          arguments: { name: 'New Test Item', data: { key: 'value' } },
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as { content: Array<{ type: string; text: string }> }
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.name).toBe('New Test Item')
      expect(parsed.id).toBeDefined()
    })

    it('should return error for unknown tool', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'nonexistentTool',
          arguments: {},
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    })

    it('should return error for missing required arguments', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'searchItems',
          arguments: {}, // Missing 'query' which is required
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
      expect(json.error!.message).toContain('query')
    })

    it('should handle method with no arguments', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'getStats',
          arguments: {},
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as { content: Array<{ type: string; text: string }> }
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.itemCount).toBeDefined()
      expect(parsed.userCount).toBeDefined()
    })

    it('should handle optional arguments correctly', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // With limit
      const request1 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'searchItems',
          arguments: { query: 'Item', limit: 1 },
        }),
        sessionId
      )

      const response1 = await handleMcp.call(doInstance, request1)
      const json1 = await parseResponse(response1) as JsonRpcResponse
      const result1 = json1.result as { content: Array<{ type: string; text: string }> }
      const parsed1 = JSON.parse(result1.content[0].text)

      expect(parsed1.length).toBe(1)

      // Without limit
      const request2 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'searchItems',
          arguments: { query: 'Item' },
        }),
        sessionId
      )

      const response2 = await handleMcp.call(doInstance, request2)
      const json2 = await parseResponse(response2) as JsonRpcResponse
      const result2 = json2.result as { content: Array<{ type: string; text: string }> }
      const parsed2 = JSON.parse(result2.content[0].text)

      expect(parsed2.length).toBe(2)
    })
  })

  // ==========================================================================
  // TESTS: RESOURCES
  // ==========================================================================

  describe('resources/list', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should return all resources defined in $mcp.resources', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('resources/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { resources: McpResource[] }
      expect(result.resources).toBeDefined()
      expect(Array.isArray(result.resources)).toBe(true)

      const resourceNames = result.resources.map((r) => r.name)
      expect(resourceNames).toContain('items')
      expect(resourceNames).toContain('users')
      expect(resourceNames).toContain('logs')
    })

    it('each resource should have a URI', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('resources/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { resources: McpResource[] }

      for (const resource of result.resources) {
        expect(resource.uri).toBeDefined()
        expect(resource.uri).toMatch(/^do:\/\//)
      }
    })

    it('resource URIs should include the DO namespace', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('resources/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { resources: McpResource[] }
      const itemsResource = result.resources.find((r) => r.name === 'items')

      expect(itemsResource!.uri).toContain('test.example.com.ai')
    })
  })

  describe('resources/read', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should read resource contents', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('resources/read', {
          uri: 'do://test.example.com.ai/items',
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }
      expect(result.contents).toBeDefined()
      expect(result.contents[0].uri).toContain('items')
      expect(result.contents[0].mimeType).toBe('application/json')

      const data = JSON.parse(result.contents[0].text)
      expect(Array.isArray(data)).toBe(true)
    })

    it('should return error for unknown resource', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('resources/read', {
          uri: 'do://test.example.com.ai/nonexistent',
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
    })

    it('should read specific item by ID if URI includes ID', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('resources/read', {
          uri: 'do://test.example.com.ai/items/1',
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }
      const data = JSON.parse(result.contents[0].text)

      expect(data.id).toBe('1')
      expect(data.name).toBe('First Item')
    })
  })

  // ==========================================================================
  // TESTS: ASYNC METHODS
  // ==========================================================================

  describe('Async Method Handling', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: AsyncMethodsDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new AsyncMethodsDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should properly await async methods', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'asyncFetch',
          arguments: { url: 'https://example.com.ai' },
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      const result = json.result as { content: Array<{ type: string; text: string }> }
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.status).toBe('fetched')
      expect(parsed.url).toBe('https://example.com.ai')
    })

    it('should handle async methods with delays', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const startTime = Date.now()

      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'asyncProcess',
          arguments: { data: { test: true }, delay: 50 },
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const endTime = Date.now()
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toBeDefined()
      expect(endTime - startTime).toBeGreaterThanOrEqual(50)
    })
  })

  // ==========================================================================
  // TESTS: ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: ErrorThrowingDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new ErrorThrowingDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should catch and return errors from method execution', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'alwaysFails',
          arguments: {},
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      // MCP spec: tool errors return isError in content, not JSON-RPC error
      const result = json.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('This method always fails')
    })

    it('should handle conditional errors correctly', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // Should succeed
      const request1 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'conditionalFail',
          arguments: { shouldFail: false },
        }),
        sessionId
      )

      const response1 = await handleMcp.call(doInstance, request1)
      const json1 = await parseResponse(response1) as JsonRpcResponse
      const result1 = json1.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(result1.isError).toBeUndefined()

      // Should fail
      const request2 = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'conditionalFail',
          arguments: { shouldFail: true },
        }),
        sessionId
      )

      const response2 = await handleMcp.call(doInstance, request2)
      const json2 = await parseResponse(response2) as JsonRpcResponse
      const result2 = json2.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(result2.isError).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: SCHEMA GENERATION
  // ==========================================================================

  describe('Schema Auto-Generation', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should generate proper JSON Schema for string parameters', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const searchTool = result.tools.find((t) => t.name === 'searchItems')

      expect(searchTool!.inputSchema.properties.query.type).toBe('string')
    })

    it('should generate proper JSON Schema for number parameters', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const searchTool = result.tools.find((t) => t.name === 'searchItems')

      expect(searchTool!.inputSchema.properties.limit.type).toBe('number')
    })

    it('should generate proper JSON Schema for object parameters', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const createTool = result.tools.find((t) => t.name === 'createItem')

      expect(createTool!.inputSchema.properties.data.type).toBe('object')
    })

    it('should mark required parameters in schema', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const searchTool = result.tools.find((t) => t.name === 'searchItems')

      expect(searchTool!.inputSchema.required).toContain('query')
      expect(searchTool!.inputSchema.required).not.toContain('limit')
    })

    it('should include parameter descriptions in schema', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const searchTool = result.tools.find((t) => t.name === 'searchItems')

      expect(searchTool!.inputSchema.properties.query.description).toBe('The search query')
    })
  })

  // ==========================================================================
  // TESTS: SESSION MANAGEMENT
  // ==========================================================================

  describe('Session Management', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    })

    it('should create a new session on initialize', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('initialize'))

      const response = await handleMcp.call(doInstance, request)
      const sessionId = response.headers.get('Mcp-Session-Id')

      expect(sessionId).toBeDefined()
      expect(sessionId!.length).toBeGreaterThan(0)
    })

    it('should reuse existing session when Mcp-Session-Id header provided', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // First initialize
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      const sessionId = initRes.headers.get('Mcp-Session-Id')!

      // Second request with session
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)
      const response = await handleMcp.call(doInstance, request)
      const returnedSessionId = response.headers.get('Mcp-Session-Id')

      expect(returnedSessionId).toBe(sessionId)
    })

    it('should return 404 for invalid session ID', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), 'invalid-session-id-123')

      const response = await handleMcp.call(doInstance, request)

      expect(response.status).toBe(404)
    })

    it('should delete session on DELETE /mcp', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      // Initialize
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      const sessionId = initRes.headers.get('Mcp-Session-Id')!

      // Delete session
      const deleteReq = new Request('https://test.do/mcp', {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const deleteRes = await handleMcp.call(doInstance, deleteReq)
      expect(deleteRes.status).toBe(204)

      // Session should now be invalid
      const listReq = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)
      const listRes = await handleMcp.call(doInstance, listReq)

      expect(listRes.status).toBe(404)
    })
  })

  // ==========================================================================
  // TESTS: MIXED METHODS (PUBLIC/PRIVATE)
  // ==========================================================================

  describe('Method Visibility', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: MixedMethodsDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new MixedMethodsDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should only expose methods defined in $mcp.tools', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('tools/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { tools: McpTool[] }
      const toolNames = result.tools.map((t) => t.name)

      expect(toolNames).toContain('publicMethod')
      expect(toolNames).not.toContain('privateHelper')
      expect(toolNames).not.toContain('internalMethod')
    })

    it('should not allow calling non-exposed methods', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(
        createJsonRpcRequest('tools/call', {
          name: 'privateHelper',
          arguments: {},
        }),
        sessionId
      )

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.error).toBeDefined()
      expect(json.error!.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    })
  })

  // ==========================================================================
  // TESTS: PING
  // ==========================================================================

  describe('ping', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })
    })

    it('should respond to ping without session', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('ping'))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toEqual({})
    })
  })

  // ==========================================================================
  // TESTS: PROMPTS (OPTIONAL)
  // ==========================================================================

  describe('prompts/list', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should return empty prompts list by default', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('prompts/list'), sessionId)

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { prompts: unknown[] }
      expect(result.prompts).toBeDefined()
      expect(Array.isArray(result.prompts)).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: SSE STREAM (GET /mcp)
  // ==========================================================================

  describe('SSE Stream', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO
    let sessionId: string

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.example.com.ai' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      sessionId = initRes.headers.get('Mcp-Session-Id')!
    })

    it('should return SSE stream on GET /mcp with session', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = new Request('https://test.do/mcp', {
        method: 'GET',
        headers: { 'Mcp-Session-Id': sessionId },
      })

      const response = await handleMcp.call(doInstance, request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    })

    it('should require session for SSE stream', async () => {
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = new Request('https://test.do/mcp', {
        method: 'GET',
      })

      const response = await handleMcp.call(doInstance, request)

      expect(response.status).toBe(400)
    })
  })

  // ==========================================================================
  // TESTS: DECORATOR PATTERN (FUTURE)
  // ==========================================================================

  describe('@mcp Decorator Pattern (Future)', () => {
    it('methods prefixed with _mcp_ should be candidates for exposure', () => {
      const proto = McpDecoratorTestDO.prototype

      // Find all _mcp_ prefixed methods
      const mcpMethods = Object.getOwnPropertyNames(proto).filter((name) =>
        name.startsWith('_mcp_') && typeof proto[name as keyof typeof proto] === 'function'
      )

      expect(mcpMethods).toContain('_mcp_createDocument')
      expect(mcpMethods).toContain('_mcp_getDocument')
      expect(mcpMethods).toContain('_mcp_listDocuments')
      expect(mcpMethods).toContain('_mcp_updateDocument')
    })

    it('getMcpMethods should return decorated methods (when implemented)', () => {
      // This test will FAIL until the getMcpMethods utility is implemented
      const getMcpMethods = (doClass: typeof DO): string[] => {
        // Placeholder - this would be implemented to extract @mcp decorated methods
        throw new Error('getMcpMethods not implemented')
      }

      expect(() => getMcpMethods(McpDecoratorTestDO)).toThrow('getMcpMethods not implemented')
    })
  })

  // ==========================================================================
  // TESTS: INTEGRATION WITH DO LIFECYCLE
  // ==========================================================================

  describe('Integration with DO Lifecycle', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: McpTestDO

    beforeEach(async () => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new McpTestDO(mockState, mockEnv)
    })

    it('MCP should work before DO initialization', async () => {
      // MCP ping should work even before initialize
      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp
      const request = createMcpRequest(createJsonRpcRequest('ping'))

      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      expect(json.result).toEqual({})
    })

    it('MCP should reflect DO namespace after initialization', async () => {
      await doInstance.initialize({ ns: 'https://custom.namespace.com' })

      const handleMcp = (doInstance as unknown as { handleMcp: (req: Request) => Promise<Response> }).handleMcp

      const initReq = createMcpRequest(createJsonRpcRequest('initialize'))
      const initRes = await handleMcp.call(doInstance, initReq)
      const sessionId = initRes.headers.get('Mcp-Session-Id')!

      const request = createMcpRequest(createJsonRpcRequest('resources/list'), sessionId)
      const response = await handleMcp.call(doInstance, request)
      const json = await parseResponse(response) as JsonRpcResponse

      const result = json.result as { resources: McpResource[] }
      const itemsResource = result.resources.find((r) => r.name === 'items')

      expect(itemsResource!.uri).toContain('custom.namespace.com')
    })
  })
})
