/**
 * MCP Tool Discovery Tests - TDD RED Phase
 *
 * Tests for MCP tools/list returning Tool Things from graph storage.
 * The MCP server should query the graph for Tool Things and return them
 * in MCP Tool format.
 *
 * Features:
 * 1. Tool Discovery - lists tools from graph via tools/list, converts to MCPTool format
 * 2. Category Filtering - filters by category, subcategory, audience
 * 3. Session Context - returns tools based on session permissions, caches per session
 *
 * These tests are RED phase TDD tests - they MUST FAIL until the endpoint
 * is implemented. Uses real MCP JSON-RPC requests (no mocks).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
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

/**
 * Create a test DO instance
 */
function createTestDO(): DO {
  const state = createMockState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all DurableObjectState properties
  return new DO(state, env)
}

/**
 * Create an initialized DO instance with namespace
 */
async function createInitializedDO(ns: string = 'https://headless.ly'): Promise<DO> {
  const doInstance = createTestDO()
  await doInstance.initialize({ ns })
  return doInstance
}

/**
 * Create an MCP JSON-RPC request
 */
function createMcpRequest(
  method: string,
  params?: unknown,
  id: string | number = 1
): Request {
  const body: { jsonrpc: '2.0'; id: string | number; method: string; params?: unknown } = {
    jsonrpc: '2.0',
    id,
    method,
  }
  if (params !== undefined) {
    body.params = params
  }

  return new Request('https://headless.ly/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/**
 * Create an MCP request with session header
 */
function createMcpRequestWithSession(
  method: string,
  sessionId: string,
  params?: unknown,
  id: string | number = 1
): Request {
  const body: { jsonrpc: '2.0'; id: string | number; method: string; params?: unknown } = {
    jsonrpc: '2.0',
    id,
    method,
  }
  if (params !== undefined) {
    body.params = params
  }

  return new Request('https://headless.ly/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify(body),
  })
}

/**
 * Initialize an MCP session and return the session ID
 */
async function initializeMcpSession(doInstance: DO): Promise<string> {
  const initRequest = createMcpRequest('initialize', {
    clientInfo: { name: 'test-client', version: '1.0' },
  })
  const initResponse = await doInstance.fetch(initRequest)
  const sessionId = initResponse.headers.get('Mcp-Session-Id')
  if (!sessionId) {
    throw new Error('Failed to initialize MCP session')
  }
  return sessionId
}

/**
 * Tool Thing interface matching expected graph storage format
 */
interface ToolThing {
  $id: string
  $type: 'Tool'
  name: string
  data: {
    description: string
    inputSchema: {
      type: 'object'
      properties: Record<string, { type: string; description?: string }>
      required?: string[]
    }
    category?: string
    subcategory?: string
    audience?: 'user' | 'agent' | 'both'
    securityLevel?: 'public' | 'restricted' | 'admin'
    permissions?: string[]
  }
}

// ============================================================================
// 1. TOOL DISCOVERY VIA MCP
// ============================================================================

describe('MCP Tool Discovery from Graph', () => {
  describe('tools/list returns Tool Things', () => {
    it('lists tools from graph via tools/list', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      // Setup: Create Tool Things in graph
      // RED: This requires implementing graph.create() integration in DO
      // and getMcpTools() querying the graph for $type: 'Tool'
      await (doInstance as any).things.create({
        $id: 'tool-send-email',
        $type: 'Tool',
        name: 'send-email',
        data: {
          description: 'Send an email message',
          inputSchema: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Email recipient' },
              subject: { type: 'string', description: 'Email subject' },
              body: { type: 'string', description: 'Email body' },
            },
            required: ['to', 'subject', 'body'],
          },
          category: 'communication',
        },
      })

      // Initialize session
      const sessionId = await initializeMcpSession(doInstance)

      // MCP request for tools/list
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: unknown[] } }

      // RED: This should fail because tools/list doesn't query graph yet
      expect(result.result.tools).toContainEqual(
        expect.objectContaining({
          name: 'send-email',
          description: 'Send an email message',
          inputSchema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              to: expect.objectContaining({ type: 'string' }),
            }),
          }),
        })
      )
    })

    it('converts Tool Thing to MCPTool format', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      // Setup Tool Thing with all fields
      await (doInstance as any).things.create({
        $id: 'tool-search-docs',
        $type: 'Tool',
        name: 'search-docs',
        data: {
          description: 'Search documentation',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results' },
            },
            required: ['query'],
          },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string; description: string; inputSchema: unknown }[] } }

      // RED: MCPTool format must have specific structure
      const searchTool = result.result.tools.find((t) => t.name === 'search-docs')
      expect(searchTool).toBeDefined()
      expect(searchTool).toEqual({
        name: 'search-docs',
        description: 'Search documentation',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
      })
    })

    it('includes all tool parameters in inputSchema', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-create-task',
        $type: 'Tool',
        name: 'create-task',
        data: {
          description: 'Create a new task',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title' },
              description: { type: 'string', description: 'Task description' },
              priority: { type: 'number', description: 'Priority 1-5' },
              assignee: { type: 'string', description: 'Assignee ID' },
              dueDate: { type: 'string', description: 'Due date ISO string' },
            },
            required: ['title'],
          },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } }

      const tool = result.result.tools.find((t) => t.name === 'create-task')
      expect(tool?.inputSchema.properties).toHaveProperty('title')
      expect(tool?.inputSchema.properties).toHaveProperty('description')
      expect(tool?.inputSchema.properties).toHaveProperty('priority')
      expect(tool?.inputSchema.properties).toHaveProperty('assignee')
      expect(tool?.inputSchema.properties).toHaveProperty('dueDate')
    })

    it('preserves required field array', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-webhook',
        $type: 'Tool',
        name: 'send-webhook',
        data: {
          description: 'Send a webhook',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Webhook URL' },
              payload: { type: 'object', description: 'JSON payload' },
              headers: { type: 'object', description: 'HTTP headers' },
            },
            required: ['url', 'payload'],
          },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string; inputSchema: { required?: string[] } }[] } }

      const tool = result.result.tools.find((t) => t.name === 'send-webhook')
      expect(tool?.inputSchema.required).toEqual(['url', 'payload'])
    })

    it('returns empty tools array when no Tool Things exist', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      // No Tool Things created - but static $mcp tools may exist
      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: unknown[] } }

      // RED: Should return tools from graph (empty) merged with static $mcp
      expect(Array.isArray(result.result.tools)).toBe(true)
    })

    it('merges graph tools with static $mcp tools', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      // Create a graph tool
      await (doInstance as any).things.create({
        $id: 'tool-graph-tool',
        $type: 'Tool',
        name: 'graph-tool',
        data: {
          description: 'A tool from graph',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: Should include both static and graph tools
      expect(result.result.tools.some((t) => t.name === 'graph-tool')).toBe(true)
    })
  })
})

// ============================================================================
// 2. CATEGORY FILTERING
// ============================================================================

describe('MCP Tool Filtering', () => {
  describe('filters by category', () => {
    it('filters tools by category via cursor', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      // Create tools with different categories
      await (doInstance as any).things.create({
        $id: 'tool-email',
        $type: 'Tool',
        name: 'send-email',
        data: {
          description: 'Send email',
          category: 'communication',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-slack',
        $type: 'Tool',
        name: 'send-slack',
        data: {
          description: 'Send Slack message',
          category: 'communication',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-analyze',
        $type: 'Tool',
        name: 'analyze-data',
        data: {
          description: 'Analyze data',
          category: 'analytics',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)

      // MCP allows cursor-based pagination - use cursor to encode category filter
      const request = createMcpRequestWithSession('tools/list', sessionId, {
        cursor: 'category:communication',
      })
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: All returned tools should be communication category
      expect(result.result.tools.length).toBe(2)
      expect(result.result.tools.every((t) =>
        t.name === 'send-email' || t.name === 'send-slack'
      )).toBe(true)
    })

    it('filters by subcategory', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-email-send',
        $type: 'Tool',
        name: 'email-send',
        data: {
          description: 'Send email',
          category: 'communication',
          subcategory: 'email',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-email-template',
        $type: 'Tool',
        name: 'email-template',
        data: {
          description: 'Create email template',
          category: 'communication',
          subcategory: 'email',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-sms',
        $type: 'Tool',
        name: 'send-sms',
        data: {
          description: 'Send SMS',
          category: 'communication',
          subcategory: 'sms',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId, {
        cursor: 'subcategory:email',
      })
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: Should only return email subcategory tools
      expect(result.result.tools.length).toBe(2)
      expect(result.result.tools.every((t) =>
        t.name === 'email-send' || t.name === 'email-template'
      )).toBe(true)
    })

    it('filters by audience (agent-only tools)', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-user-search',
        $type: 'Tool',
        name: 'user-search',
        data: {
          description: 'User-facing search',
          audience: 'user',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-agent-memory',
        $type: 'Tool',
        name: 'agent-memory',
        data: {
          description: 'Agent memory store',
          audience: 'agent',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-both',
        $type: 'Tool',
        name: 'shared-tool',
        data: {
          description: 'Shared tool',
          audience: 'both',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId, {
        cursor: 'audience:agent',
      })
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: Should return agent and both audience tools
      expect(result.result.tools.some((t) => t.name === 'agent-memory')).toBe(true)
      expect(result.result.tools.some((t) => t.name === 'shared-tool')).toBe(true)
      expect(result.result.tools.some((t) => t.name === 'user-search')).toBe(false)
    })

    it('excludes restricted security level tools', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-public',
        $type: 'Tool',
        name: 'public-tool',
        data: {
          description: 'Public tool',
          securityLevel: 'public',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-restricted',
        $type: 'Tool',
        name: 'restricted-tool',
        data: {
          description: 'Restricted tool',
          securityLevel: 'restricted',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-admin',
        $type: 'Tool',
        name: 'admin-tool',
        data: {
          description: 'Admin tool',
          securityLevel: 'admin',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)

      // Default request should exclude restricted/admin tools
      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: Should only return public security level tools by default
      expect(result.result.tools.some((t) => t.name === 'public-tool')).toBe(true)
      expect(result.result.tools.some((t) => t.name === 'restricted-tool')).toBe(false)
      expect(result.result.tools.some((t) => t.name === 'admin-tool')).toBe(false)
    })

    it('combines multiple filters', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-match',
        $type: 'Tool',
        name: 'matching-tool',
        data: {
          description: 'Matches all filters',
          category: 'communication',
          audience: 'agent',
          securityLevel: 'public',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-wrong-cat',
        $type: 'Tool',
        name: 'wrong-category',
        data: {
          description: 'Wrong category',
          category: 'analytics',
          audience: 'agent',
          securityLevel: 'public',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)
      const request = createMcpRequestWithSession('tools/list', sessionId, {
        cursor: 'category:communication,audience:agent',
      })
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: Should only return tool matching all filters
      expect(result.result.tools.length).toBe(1)
      expect(result.result.tools[0].name).toBe('matching-tool')
    })
  })
})

// ============================================================================
// 3. SESSION CONTEXT
// ============================================================================

describe('Session-Scoped Tools', () => {
  describe('returns tools based on session permissions', () => {
    it('returns tools based on session permissions', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      // Create tools with different permission requirements
      await (doInstance as any).things.create({
        $id: 'tool-basic',
        $type: 'Tool',
        name: 'basic-tool',
        data: {
          description: 'Basic tool - no permissions required',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      await (doInstance as any).things.create({
        $id: 'tool-admin',
        $type: 'Tool',
        name: 'admin-tool',
        data: {
          description: 'Admin tool - requires admin permission',
          permissions: ['admin:write'],
          inputSchema: { type: 'object', properties: {} },
        },
      })

      // Initialize session with limited permissions
      const initRequest = new Request('https://headless.ly/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: { name: 'test', version: '1.0' },
            // Session should have limited permissions
          },
        }),
      })
      const initResponse = await doInstance.fetch(initRequest)
      const sessionId = initResponse.headers.get('Mcp-Session-Id')!

      const request = createMcpRequestWithSession('tools/list', sessionId)
      const response = await doInstance.fetch(request)
      const result = await response.json() as { result: { tools: { name: string }[] } }

      // RED: Only returns tools user has permission to use
      expect(result.result.tools.some((t) => t.name === 'basic-tool')).toBe(true)
      expect(result.result.tools.some((t) => t.name === 'admin-tool')).toBe(false)
    })

    it('caches tool list per session', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-cached',
        $type: 'Tool',
        name: 'cached-tool',
        data: {
          description: 'Tool to test caching',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)

      // First request
      const request1 = createMcpRequestWithSession('tools/list', sessionId)
      const response1 = await doInstance.fetch(request1)
      const result1 = await response1.json() as { result: { tools: unknown[] } }
      const tools1Count = result1.result.tools.length

      // Add another tool
      await (doInstance as any).things.create({
        $id: 'tool-new',
        $type: 'Tool',
        name: 'new-tool',
        data: {
          description: 'New tool added after cache',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      // Second request with same session should use cache
      const request2 = createMcpRequestWithSession('tools/list', sessionId)
      const response2 = await doInstance.fetch(request2)
      const result2 = await response2.json() as { result: { tools: unknown[] } }

      // RED: Should return same count (cached) until cache invalidated
      expect(result2.result.tools.length).toBe(tools1Count)
    })

    it('invalidates cache on listChanged notification', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-initial',
        $type: 'Tool',
        name: 'initial-tool',
        data: {
          description: 'Initial tool',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)

      // First request
      const request1 = createMcpRequestWithSession('tools/list', sessionId)
      const response1 = await doInstance.fetch(request1)
      const result1 = await response1.json() as { result: { tools: unknown[] } }

      // Simulate tool addition with listChanged notification
      await (doInstance as any).things.create({
        $id: 'tool-added',
        $type: 'Tool',
        name: 'added-tool',
        data: {
          description: 'Tool added with notification',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      // Send notifications/tools/list_changed to invalidate cache
      const notifyRequest = new Request('https://headless.ly/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
          // No id - this is a notification
        }),
      })
      await doInstance.fetch(notifyRequest)

      // Third request should see new tool after cache invalidation
      const request3 = createMcpRequestWithSession('tools/list', sessionId)
      const response3 = await doInstance.fetch(request3)
      const result3 = await response3.json() as { result: { tools: { name: string }[] } }

      // RED: Cache should be invalidated and show new tool
      expect(result3.result.tools.length).toBeGreaterThan(result1.result.tools.length)
      expect(result3.result.tools.some((t) => t.name === 'added-tool')).toBe(true)
    })

    it('different sessions have independent caches', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-shared',
        $type: 'Tool',
        name: 'shared-tool',
        data: {
          description: 'Shared tool',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      // Create two sessions
      const sessionId1 = await initializeMcpSession(doInstance)
      const sessionId2 = await initializeMcpSession(doInstance)

      // First session caches tools
      const request1 = createMcpRequestWithSession('tools/list', sessionId1)
      await doInstance.fetch(request1)

      // Add new tool
      await (doInstance as any).things.create({
        $id: 'tool-new',
        $type: 'Tool',
        name: 'new-tool',
        data: {
          description: 'New tool',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      // Second session should see new tool (no cache yet)
      const request2 = createMcpRequestWithSession('tools/list', sessionId2)
      const response2 = await doInstance.fetch(request2)
      const result2 = await response2.json() as { result: { tools: { name: string }[] } }

      // RED: Session 2 should see new tool (independent cache)
      expect(result2.result.tools.some((t) => t.name === 'new-tool')).toBe(true)
    })
  })

  describe('handles tool updates', () => {
    it('detects Tool Thing updates', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-updatable',
        $type: 'Tool',
        name: 'updatable-tool',
        data: {
          description: 'Original description',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)

      // Get initial tools
      const request1 = createMcpRequestWithSession('tools/list', sessionId)
      const response1 = await doInstance.fetch(request1)
      const result1 = await response1.json() as { result: { tools: { name: string; description: string }[] } }

      const originalTool = result1.result.tools.find((t) => t.name === 'updatable-tool')
      expect(originalTool?.description).toBe('Original description')

      // Update the tool
      await (doInstance as any).things.update('tool-updatable', {
        data: {
          description: 'Updated description',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string' },
              newParam: { type: 'number' },
            },
          },
        },
      })

      // Invalidate cache
      const notifyRequest = new Request('https://headless.ly/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
        }),
      })
      await doInstance.fetch(notifyRequest)

      // Get updated tools
      const request2 = createMcpRequestWithSession('tools/list', sessionId)
      const response2 = await doInstance.fetch(request2)
      const result2 = await response2.json() as { result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[] } }

      const updatedTool = result2.result.tools.find((t) => t.name === 'updatable-tool')

      // RED: Should reflect the updated description and schema
      expect(updatedTool?.description).toBe('Updated description')
      expect(updatedTool?.inputSchema.properties).toHaveProperty('newParam')
    })

    it('removes deleted Tool Things from list', async () => {
      const doInstance = await createInitializedDO('https://headless.ly')

      await (doInstance as any).things.create({
        $id: 'tool-deletable',
        $type: 'Tool',
        name: 'deletable-tool',
        data: {
          description: 'Tool to be deleted',
          inputSchema: { type: 'object', properties: {} },
        },
      })

      const sessionId = await initializeMcpSession(doInstance)

      // Verify tool exists
      const request1 = createMcpRequestWithSession('tools/list', sessionId)
      const response1 = await doInstance.fetch(request1)
      const result1 = await response1.json() as { result: { tools: { name: string }[] } }
      expect(result1.result.tools.some((t) => t.name === 'deletable-tool')).toBe(true)

      // Delete the tool
      await (doInstance as any).things.delete('tool-deletable')

      // Invalidate cache
      const notifyRequest = new Request('https://headless.ly/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
        }),
      })
      await doInstance.fetch(notifyRequest)

      // Verify tool is removed
      const request2 = createMcpRequestWithSession('tools/list', sessionId)
      const response2 = await doInstance.fetch(request2)
      const result2 = await response2.json() as { result: { tools: { name: string }[] } }

      // RED: Deleted tool should not appear in list
      expect(result2.result.tools.some((t) => t.name === 'deletable-tool')).toBe(false)
    })
  })
})

// ============================================================================
// 4. TOOLS/CALL WITH GRAPH TOOLS
// ============================================================================

describe('MCP tools/call with Graph Tools', () => {
  it('calls graph-defined tool via tools/call', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // Create a tool that maps to a DO method
    await (doInstance as any).things.create({
      $id: 'tool-echo',
      $type: 'Tool',
      name: 'echo',
      data: {
        description: 'Echo the input',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to echo' },
          },
          required: ['message'],
        },
        // Method binding - maps to DO instance method
        method: 'echo',
      },
    })

    // Add echo method to DO for this test
    ;(doInstance as any).echo = (message: string) => `Echo: ${message}`

    const sessionId = await initializeMcpSession(doInstance)

    const callRequest = createMcpRequestWithSession('tools/call', sessionId, {
      name: 'echo',
      arguments: { message: 'Hello World' },
    })

    const response = await doInstance.fetch(callRequest)
    const result = await response.json() as { result: { content: { type: string; text: string }[] } }

    // RED: Should execute the graph tool and return result
    expect(result.result.content).toContainEqual({
      type: 'text',
      text: expect.stringContaining('Hello World'),
    })
  })

  it('validates required arguments for graph tools', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    await (doInstance as any).things.create({
      $id: 'tool-required',
      $type: 'Tool',
      name: 'required-args-tool',
      data: {
        description: 'Tool with required args',
        inputSchema: {
          type: 'object',
          properties: {
            required1: { type: 'string' },
            required2: { type: 'string' },
            optional: { type: 'string' },
          },
          required: ['required1', 'required2'],
        },
      },
    })

    const sessionId = await initializeMcpSession(doInstance)

    // Call without required argument
    const callRequest = createMcpRequestWithSession('tools/call', sessionId, {
      name: 'required-args-tool',
      arguments: { required1: 'value1' }, // Missing required2
    })

    const response = await doInstance.fetch(callRequest)
    const result = await response.json() as { error?: { code: number; message: string } }

    // RED: Should return error for missing required argument
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('required2')
  })
})
