import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MCPSDKAdapter,
  MCPSDKAdapterConfig,
  createMCPSDKAdapter,
  MCPSDKTransport,
  MCPSDKConnectionState,
  MCPSDKSession,
  MCPSDKToolRegistration,
  MCPSDKError,
  MCPSDKErrorCode,
} from '../../src/mcp/sdk-adapter'

/**
 * MCP SDK Adapter Tests
 *
 * These tests verify the integration with the official MCP SDK,
 * including SDK initialization, tool registration, request/response
 * handling, error propagation, and connection lifecycle.
 *
 * RED phase: These tests should fail because the SDK adapter
 * implementation doesn't exist yet.
 */

describe('MCP SDK Adapter', () => {
  describe('SDK initialization', () => {
    it('should create SDK adapter with default configuration', () => {
      const adapter = createMCPSDKAdapter()
      expect(adapter).toBeDefined()
      expect(adapter).toBeInstanceOf(MCPSDKAdapter)
    })

    it('should create SDK adapter with custom configuration', () => {
      const config: MCPSDKAdapterConfig = {
        name: 'gitx.do-sdk-server',
        version: '1.0.0',
        vendor: 'gitx.do',
      }
      const adapter = createMCPSDKAdapter(config)
      expect(adapter).toBeDefined()
      expect(adapter.getConfig().name).toBe('gitx.do-sdk-server')
      expect(adapter.getConfig().version).toBe('1.0.0')
      expect(adapter.getConfig().vendor).toBe('gitx.do')
    })

    it('should have default name if not provided', () => {
      const adapter = createMCPSDKAdapter()
      expect(adapter.getConfig().name).toBe('gitx.do')
    })

    it('should have default version matching package.json', () => {
      const adapter = createMCPSDKAdapter()
      expect(adapter.getConfig().version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('should support stdio transport by default', () => {
      const adapter = createMCPSDKAdapter()
      expect(adapter.getSupportedTransports()).toContain('stdio')
    })

    it('should support SSE transport when configured', () => {
      const adapter = createMCPSDKAdapter({
        transports: ['stdio', 'sse'],
      })
      expect(adapter.getSupportedTransports()).toContain('sse')
    })

    it('should support HTTP transport when configured', () => {
      const adapter = createMCPSDKAdapter({
        transports: ['http'],
      })
      expect(adapter.getSupportedTransports()).toContain('http')
    })

    it('should validate configuration on creation', () => {
      expect(() =>
        createMCPSDKAdapter({
          name: '', // invalid empty name
        })
      ).toThrow(/name|invalid|required/i)
    })

    it('should support custom protocol version', () => {
      const adapter = createMCPSDKAdapter({
        protocolVersion: '2024-11-05',
      })
      expect(adapter.getProtocolVersion()).toBe('2024-11-05')
    })

    it('should use latest protocol version by default', () => {
      const adapter = createMCPSDKAdapter()
      expect(adapter.getProtocolVersion()).toBe('2024-11-05')
    })

    it('should expose SDK version information', () => {
      const adapter = createMCPSDKAdapter()
      expect(adapter.getSDKVersion()).toBeDefined()
      expect(adapter.getSDKVersion()).toMatch(/^\d+\.\d+/)
    })

    it('should configure capabilities during initialization', () => {
      const adapter = createMCPSDKAdapter({
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true },
          prompts: {},
        },
      })
      expect(adapter.getCapabilities().tools).toBeDefined()
      expect(adapter.getCapabilities().tools?.listChanged).toBe(true)
    })
  })

  describe('SDK server lifecycle', () => {
    let adapter: MCPSDKAdapter

    beforeEach(() => {
      adapter = createMCPSDKAdapter()
    })

    afterEach(async () => {
      if (adapter.getConnectionState() !== 'disconnected') {
        await adapter.shutdown()
      }
    })

    it('should start in disconnected state', () => {
      expect(adapter.getConnectionState()).toBe('disconnected')
    })

    it('should transition to initializing state when starting', async () => {
      const statePromise = new Promise<MCPSDKConnectionState>((resolve) => {
        adapter.onStateChange((state) => {
          if (state === 'initializing') {
            resolve(state)
          }
        })
      })

      adapter.start()
      const state = await statePromise
      expect(state).toBe('initializing')
    })

    it('should transition to connected state after initialization', async () => {
      await adapter.start()
      expect(adapter.getConnectionState()).toBe('connected')
    })

    it('should emit connected event when fully initialized', async () => {
      const connectedPromise = new Promise<void>((resolve) => {
        adapter.onConnected(() => resolve())
      })

      await adapter.start()
      await connectedPromise
    })

    it('should handle client initialization request', async () => {
      await adapter.start()

      const result = await adapter.handleClientInitialize({
        protocolVersion: '2024-11-05',
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
        capabilities: {},
      })

      expect(result.serverInfo).toBeDefined()
      expect(result.serverInfo.name).toBe('gitx.do')
      expect(result.capabilities).toBeDefined()
    })

    it('should reject incompatible protocol versions', async () => {
      await adapter.start()

      await expect(
        adapter.handleClientInitialize({
          protocolVersion: '2023-01-01', // old version
          clientInfo: { name: 'test-client', version: '1.0.0' },
          capabilities: {},
        })
      ).rejects.toThrow(/protocol|version|incompatible/i)
    })

    it('should transition to disconnected state after shutdown', async () => {
      await adapter.start()
      await adapter.shutdown()
      expect(adapter.getConnectionState()).toBe('disconnected')
    })

    it('should emit disconnected event on shutdown', async () => {
      await adapter.start()

      const disconnectedPromise = new Promise<void>((resolve) => {
        adapter.onDisconnected(() => resolve())
      })

      await adapter.shutdown()
      await disconnectedPromise
    })

    it('should throw if start is called while already started', async () => {
      await adapter.start()
      await expect(adapter.start()).rejects.toThrow(/already|started|running/i)
    })

    it('should handle graceful shutdown with pending requests', async () => {
      await adapter.start()

      // Simulate a pending request
      const pendingRequest = adapter.simulatePendingRequest()

      const shutdownPromise = adapter.shutdown({ graceful: true, timeout: 5000 })
      await pendingRequest.complete()

      await expect(shutdownPromise).resolves.not.toThrow()
    })

    it('should force shutdown after timeout', async () => {
      await adapter.start()

      // Simulate a request that won't complete
      adapter.simulatePendingRequest()

      await expect(
        adapter.shutdown({ graceful: true, timeout: 100 })
      ).resolves.not.toThrow()
    })
  })

  describe('Tool registration with SDK', () => {
    let adapter: MCPSDKAdapter

    beforeEach(async () => {
      adapter = createMCPSDKAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.getConnectionState() !== 'disconnected') {
        await adapter.shutdown()
      }
    })

    it('should register a tool using SDK format', () => {
      const registration: MCPSDKToolRegistration = {
        name: 'git_status',
        description: 'Get repository status',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
          },
        },
        handler: async (params) => ({
          content: [{ type: 'text', text: 'status output' }],
        }),
      }

      expect(() => adapter.registerTool(registration)).not.toThrow()
    })

    it('should assign unique tool IDs', () => {
      adapter.registerTool({
        name: 'tool_1',
        description: 'First tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      adapter.registerTool({
        name: 'tool_2',
        description: 'Second tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      const tool1 = adapter.getTool('tool_1')
      const tool2 = adapter.getTool('tool_2')

      expect(tool1?.id).toBeDefined()
      expect(tool2?.id).toBeDefined()
      expect(tool1?.id).not.toBe(tool2?.id)
    })

    it('should emit tools/list_changed notification on registration', async () => {
      const notificationPromise = new Promise<void>((resolve) => {
        adapter.onNotification('tools/list_changed', () => resolve())
      })

      adapter.registerTool({
        name: 'new_tool',
        description: 'A new tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      await expect(notificationPromise).resolves.not.toThrow()
    })

    it('should register multiple tools in batch', () => {
      const tools: MCPSDKToolRegistration[] = [
        {
          name: 'tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'a' }] }),
        },
        {
          name: 'tool_b',
          description: 'Tool B',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'b' }] }),
        },
      ]

      expect(() => adapter.registerTools(tools)).not.toThrow()
      expect(adapter.listTools()).toHaveLength(2)
    })

    it('should prevent duplicate tool names', () => {
      adapter.registerTool({
        name: 'duplicate',
        description: 'First',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'first' }] }),
      })

      expect(() =>
        adapter.registerTool({
          name: 'duplicate',
          description: 'Second',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'second' }] }),
        })
      ).toThrow(/duplicate|already|exists/i)
    })

    it('should unregister a tool by name', () => {
      adapter.registerTool({
        name: 'removable',
        description: 'Removable tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      expect(adapter.getTool('removable')).toBeDefined()
      adapter.unregisterTool('removable')
      expect(adapter.getTool('removable')).toBeUndefined()
    })

    it('should emit tools/list_changed notification on unregistration', async () => {
      adapter.registerTool({
        name: 'temp_tool',
        description: 'Temporary tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      const notificationPromise = new Promise<void>((resolve) => {
        adapter.onNotification('tools/list_changed', () => resolve())
      })

      adapter.unregisterTool('temp_tool')

      await expect(notificationPromise).resolves.not.toThrow()
    })

    it('should register gitx.do tools via convenience method', () => {
      adapter.registerGitdoTools()

      const tools = adapter.listTools()
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.map((t) => t.name)).toContain('git_status')
      expect(tools.map((t) => t.name)).toContain('git_log')
    })

    it('should validate tool schema on registration', () => {
      expect(() =>
        adapter.registerTool({
          name: 'invalid_tool',
          description: 'Tool with invalid schema',
          inputSchema: {
            type: 'invalid_type' as 'object', // invalid type
            properties: {},
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })
      ).toThrow(/schema|invalid|type/i)
    })
  })

  describe('Request/response handling', () => {
    let adapter: MCPSDKAdapter

    beforeEach(async () => {
      adapter = createMCPSDKAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.getConnectionState() !== 'disconnected') {
        await adapter.shutdown()
      }
    })

    describe('tools/list request', () => {
      it('should handle tools/list request via SDK', async () => {
        adapter.registerTool({
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })

        const result = await adapter.handleToolsList()

        expect(result.tools).toBeDefined()
        expect(Array.isArray(result.tools)).toBe(true)
        expect(result.tools).toHaveLength(1)
        expect(result.tools[0].name).toBe('test_tool')
      })

      it('should include full tool schema in response', async () => {
        adapter.registerTool({
          name: 'schema_tool',
          description: 'Tool with schema',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string', description: 'First param' },
            },
            required: ['param1'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })

        const result = await adapter.handleToolsList()

        expect(result.tools[0].inputSchema).toBeDefined()
        expect(result.tools[0].inputSchema.properties.param1).toBeDefined()
        expect(result.tools[0].inputSchema.required).toContain('param1')
      })

      it('should support pagination cursor', async () => {
        // Register many tools
        for (let i = 0; i < 20; i++) {
          adapter.registerTool({
            name: `tool_${i}`,
            description: `Tool ${i}`,
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({ content: [{ type: 'text', text: `${i}` }] }),
          })
        }

        const firstPage = await adapter.handleToolsList({ cursor: undefined })
        expect(firstPage.tools.length).toBeLessThanOrEqual(10)
        expect(firstPage.nextCursor).toBeDefined()

        const secondPage = await adapter.handleToolsList({
          cursor: firstPage.nextCursor,
        })
        expect(secondPage.tools.length).toBeGreaterThan(0)
      })
    })

    describe('tools/call request', () => {
      beforeEach(() => {
        adapter.registerTool({
          name: 'echo',
          description: 'Echoes the message',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Message to echo' },
            },
            required: ['message'],
          },
          handler: async (params) => ({
            content: [{ type: 'text', text: `Echo: ${params.message}` }],
          }),
        })
      })

      it('should handle tools/call request via SDK', async () => {
        const result = await adapter.handleToolsCall({
          name: 'echo',
          arguments: { message: 'Hello, World!' },
        })

        expect(result.content).toBeDefined()
        expect(result.content[0].text).toBe('Echo: Hello, World!')
      })

      it('should validate arguments against schema', async () => {
        await expect(
          adapter.handleToolsCall({
            name: 'echo',
            arguments: {}, // missing required 'message'
          })
        ).rejects.toThrow(/required|missing|message/i)
      })

      it('should return error for non-existent tool', async () => {
        await expect(
          adapter.handleToolsCall({
            name: 'nonexistent',
            arguments: {},
          })
        ).rejects.toThrow(/not found|unknown|nonexistent/i)
      })

      it('should handle async tool handlers', async () => {
        adapter.registerTool({
          name: 'async_tool',
          description: 'An async tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            return { content: [{ type: 'text', text: 'async result' }] }
          },
        })

        const result = await adapter.handleToolsCall({
          name: 'async_tool',
          arguments: {},
        })

        expect(result.content[0].text).toBe('async result')
      })

      it('should track request progress', async () => {
        const progressUpdates: number[] = []

        adapter.registerTool({
          name: 'progress_tool',
          description: 'Tool with progress',
          inputSchema: { type: 'object', properties: {} },
          handler: async (params, context) => {
            await context.reportProgress(25, 100)
            await context.reportProgress(50, 100)
            await context.reportProgress(75, 100)
            await context.reportProgress(100, 100)
            return { content: [{ type: 'text', text: 'done' }] }
          },
        })

        adapter.onProgress((progress) => {
          progressUpdates.push(progress.progress)
        })

        await adapter.handleToolsCall({
          name: 'progress_tool',
          arguments: {},
        })

        expect(progressUpdates).toEqual([25, 50, 75, 100])
      })

      it('should support cancellation tokens', async () => {
        let cancelled = false

        adapter.registerTool({
          name: 'cancellable_tool',
          description: 'A cancellable tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async (params, context) => {
            await new Promise((resolve) => setTimeout(resolve, 100))
            if (context.isCancelled()) {
              cancelled = true
              return { content: [{ type: 'text', text: 'cancelled' }], isError: true }
            }
            return { content: [{ type: 'text', text: 'done' }] }
          },
        })

        const callPromise = adapter.handleToolsCall({
          name: 'cancellable_tool',
          arguments: {},
        })

        // Cancel after starting
        adapter.cancelRequest(callPromise.requestId)

        const result = await callPromise
        expect(cancelled).toBe(true)
        expect(result.isError).toBe(true)
      })
    })

    describe('JSON-RPC message handling', () => {
      it('should handle raw JSON-RPC messages', async () => {
        const message = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        })

        const response = await adapter.handleMessage(message)
        const parsed = JSON.parse(response)

        expect(parsed.jsonrpc).toBe('2.0')
        expect(parsed.id).toBe(1)
        expect(parsed.result).toBeDefined()
      })

      it('should handle batch requests', async () => {
        const messages = JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        ])

        const response = await adapter.handleMessage(messages)
        const parsed = JSON.parse(response)

        expect(Array.isArray(parsed)).toBe(true)
        expect(parsed).toHaveLength(2)
        expect(parsed[0].id).toBe(1)
        expect(parsed[1].id).toBe(2)
      })

      it('should return parse error for invalid JSON', async () => {
        const response = await adapter.handleMessage('not valid json')
        const parsed = JSON.parse(response)

        expect(parsed.error).toBeDefined()
        expect(parsed.error.code).toBe(-32700) // Parse error
      })

      it('should preserve request ID in response', async () => {
        const message = JSON.stringify({
          jsonrpc: '2.0',
          id: 'custom-string-id',
          method: 'tools/list',
          params: {},
        })

        const response = await adapter.handleMessage(message)
        const parsed = JSON.parse(response)

        expect(parsed.id).toBe('custom-string-id')
      })
    })
  })

  describe('Error propagation', () => {
    let adapter: MCPSDKAdapter

    beforeEach(async () => {
      adapter = createMCPSDKAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.getConnectionState() !== 'disconnected') {
        await adapter.shutdown()
      }
    })

    it('should propagate tool handler errors as isError result', async () => {
      adapter.registerTool({
        name: 'failing_tool',
        description: 'A tool that fails',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Tool execution failed')
        },
      })

      const result = await adapter.handleToolsCall({
        name: 'failing_tool',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Tool execution failed')
    })

    it('should create MCPSDKError with proper code', () => {
      const error = new MCPSDKError(
        MCPSDKErrorCode.INVALID_PARAMS,
        'Invalid parameters'
      )

      expect(error.code).toBe(MCPSDKErrorCode.INVALID_PARAMS)
      expect(error.code).toBe(-32602)
      expect(error.message).toBe('Invalid parameters')
    })

    it('should include error data in MCPSDKError', () => {
      const error = new MCPSDKError(
        MCPSDKErrorCode.INVALID_PARAMS,
        'Invalid',
        { field: 'message', expected: 'string' }
      )

      expect(error.data).toEqual({ field: 'message', expected: 'string' })
    })

    it('should convert MCPSDKError to JSON-RPC format', () => {
      const error = new MCPSDKError(
        MCPSDKErrorCode.METHOD_NOT_FOUND,
        'Method not found'
      )

      const json = error.toJSONRPC()

      expect(json).toEqual({
        code: -32601,
        message: 'Method not found',
      })
    })

    it('should have all standard JSON-RPC error codes', () => {
      expect(MCPSDKErrorCode.PARSE_ERROR).toBe(-32700)
      expect(MCPSDKErrorCode.INVALID_REQUEST).toBe(-32600)
      expect(MCPSDKErrorCode.METHOD_NOT_FOUND).toBe(-32601)
      expect(MCPSDKErrorCode.INVALID_PARAMS).toBe(-32602)
      expect(MCPSDKErrorCode.INTERNAL_ERROR).toBe(-32603)
    })

    it('should have MCP-specific error codes', () => {
      expect(MCPSDKErrorCode.TOOL_NOT_FOUND).toBeDefined()
      expect(MCPSDKErrorCode.RESOURCE_NOT_FOUND).toBeDefined()
      expect(MCPSDKErrorCode.PROMPT_NOT_FOUND).toBeDefined()
      expect(MCPSDKErrorCode.CAPABILITY_NOT_SUPPORTED).toBeDefined()
    })

    it('should emit error events for unhandled errors', async () => {
      const errorPromise = new Promise<MCPSDKError>((resolve) => {
        adapter.onError((error) => resolve(error))
      })

      // Trigger an internal error
      adapter.simulateInternalError(new Error('Unexpected error'))

      const error = await errorPromise
      expect(error).toBeInstanceOf(MCPSDKError)
      expect(error.code).toBe(MCPSDKErrorCode.INTERNAL_ERROR)
    })

    it('should log errors when configured', async () => {
      const logSpy = vi.fn()
      const adapter = createMCPSDKAdapter({
        logger: { error: logSpy },
      })
      await adapter.start()

      adapter.registerTool({
        name: 'error_tool',
        description: 'Tool that errors',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Logged error')
        },
      })

      await adapter.handleToolsCall({
        name: 'error_tool',
        arguments: {},
      })

      expect(logSpy).toHaveBeenCalled()

      await adapter.shutdown()
    })

    it('should include stack trace in development mode', async () => {
      const adapter = createMCPSDKAdapter({
        mode: 'development',
      })
      await adapter.start()

      adapter.registerTool({
        name: 'stack_tool',
        description: 'Tool for stack trace test',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Stack trace error')
        },
      })

      const result = await adapter.handleToolsCall({
        name: 'stack_tool',
        arguments: {},
      })

      expect(result.content[0].text).toContain('at')

      await adapter.shutdown()
    })

    it('should hide stack trace in production mode', async () => {
      const adapter = createMCPSDKAdapter({
        mode: 'production',
      })
      await adapter.start()

      adapter.registerTool({
        name: 'prod_tool',
        description: 'Tool for production test',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Production error')
        },
      })

      const result = await adapter.handleToolsCall({
        name: 'prod_tool',
        arguments: {},
      })

      expect(result.content[0].text).not.toContain('at ')

      await adapter.shutdown()
    })
  })

  describe('Connection lifecycle', () => {
    let adapter: MCPSDKAdapter

    beforeEach(() => {
      adapter = createMCPSDKAdapter()
    })

    afterEach(async () => {
      if (adapter.getConnectionState() !== 'disconnected') {
        await adapter.shutdown()
      }
    })

    it('should track connection state transitions', async () => {
      const states: MCPSDKConnectionState[] = []

      adapter.onStateChange((state) => {
        states.push(state)
      })

      await adapter.start()
      await adapter.shutdown()

      expect(states).toContain('initializing')
      expect(states).toContain('connected')
      expect(states).toContain('disconnected')
    })

    it('should create session on connection', async () => {
      await adapter.start()

      await adapter.handleClientInitialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0.0' },
        capabilities: {},
      })

      const session = adapter.getSession()
      expect(session).toBeDefined()
      expect(session?.clientInfo.name).toBe('test')
    })

    it('should store client capabilities in session', async () => {
      await adapter.start()

      await adapter.handleClientInitialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0.0' },
        capabilities: {
          sampling: {},
          roots: { listChanged: true },
        },
      })

      const session = adapter.getSession()
      expect(session?.clientCapabilities.sampling).toBeDefined()
      expect(session?.clientCapabilities.roots?.listChanged).toBe(true)
    })

    it('should generate unique session IDs', async () => {
      await adapter.start()

      await adapter.handleClientInitialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'client1', version: '1.0.0' },
        capabilities: {},
      })

      const session1Id = adapter.getSession()?.id

      await adapter.shutdown()

      // New connection
      adapter = createMCPSDKAdapter()
      await adapter.start()

      await adapter.handleClientInitialize({
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'client2', version: '1.0.0' },
        capabilities: {},
      })

      const session2Id = adapter.getSession()?.id

      expect(session1Id).not.toBe(session2Id)
    })

    it('should handle ping/pong for keepalive', async () => {
      await adapter.start()

      const pongReceived = new Promise<void>((resolve) => {
        adapter.onPong(() => resolve())
      })

      adapter.sendPing()

      await expect(pongReceived).resolves.not.toThrow()
    })

    it('should detect connection timeout', async () => {
      const adapter = createMCPSDKAdapter({
        pingInterval: 100,
        pingTimeout: 50,
      })

      await adapter.start()

      // Simulate client not responding to pings
      adapter.simulateClientUnresponsive()

      const timeoutPromise = new Promise<void>((resolve) => {
        adapter.onConnectionTimeout(() => resolve())
      })

      await expect(timeoutPromise).resolves.not.toThrow()

      await adapter.shutdown()
    })

    it('should support reconnection', async () => {
      await adapter.start()
      await adapter.shutdown()

      // Should be able to start again
      await adapter.start()
      expect(adapter.getConnectionState()).toBe('connected')
    })

    it('should clean up resources on disconnect', async () => {
      await adapter.start()

      adapter.registerTool({
        name: 'temp_tool',
        description: 'Temporary',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      await adapter.shutdown({ cleanup: true })

      // Resources should be cleaned up
      expect(adapter.listTools()).toHaveLength(0)
    })

    it('should preserve tools after normal shutdown', async () => {
      await adapter.start()

      adapter.registerTool({
        name: 'persistent_tool',
        description: 'Persistent',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      await adapter.shutdown({ cleanup: false })
      await adapter.start()

      expect(adapter.listTools()).toHaveLength(1)
    })
  })

  describe('Transport layer integration', () => {
    describe('stdio transport', () => {
      it('should create stdio transport', () => {
        const transport = MCPSDKTransport.createStdio()
        expect(transport).toBeDefined()
        expect(transport.type).toBe('stdio')
      })

      it('should read from stdin and write to stdout', async () => {
        const transport = MCPSDKTransport.createStdio({
          stdin: createMockReadable(),
          stdout: createMockWritable(),
        })

        const adapter = createMCPSDKAdapter()
        await adapter.connect(transport)

        expect(adapter.getConnectionState()).toBe('connected')

        await adapter.shutdown()
      })
    })

    describe('SSE transport', () => {
      it('should create SSE transport', () => {
        const transport = MCPSDKTransport.createSSE({
          endpoint: '/mcp/sse',
        })
        expect(transport).toBeDefined()
        expect(transport.type).toBe('sse')
      })

      it('should handle SSE connection', async () => {
        const transport = MCPSDKTransport.createSSE({
          endpoint: '/mcp/sse',
        })

        const adapter = createMCPSDKAdapter()

        // Mock HTTP request handling
        const mockRequest = createMockSSERequest()
        await transport.handleRequest(mockRequest)

        expect(transport.isConnected()).toBe(true)
      })
    })

    describe('HTTP transport', () => {
      it('should create HTTP transport', () => {
        const transport = MCPSDKTransport.createHTTP({
          endpoint: '/mcp',
        })
        expect(transport).toBeDefined()
        expect(transport.type).toBe('http')
      })

      it('should handle HTTP POST requests', async () => {
        const transport = MCPSDKTransport.createHTTP({
          endpoint: '/mcp',
        })

        const adapter = createMCPSDKAdapter()
        await adapter.connect(transport)

        const mockRequest = createMockHTTPRequest({
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {},
          }),
        })

        const response = await transport.handleRequest(mockRequest)

        expect(response.status).toBe(200)
        expect(response.headers['Content-Type']).toBe('application/json')
      })
    })

    describe('Custom transport', () => {
      it('should support custom transport implementation', async () => {
        const customTransport: MCPSDKTransport = {
          type: 'custom',
          send: vi.fn(),
          receive: vi.fn(),
          close: vi.fn(),
          isConnected: () => true,
        }

        const adapter = createMCPSDKAdapter()
        await adapter.connect(customTransport)

        expect(adapter.getConnectionState()).toBe('connected')

        await adapter.shutdown()
      })
    })
  })

  describe('Integration with gitx.do tools', () => {
    let adapter: MCPSDKAdapter

    beforeEach(async () => {
      adapter = createMCPSDKAdapter()
      await adapter.start()
      adapter.registerGitdoTools()
    })

    afterEach(async () => {
      if (adapter.getConnectionState() !== 'disconnected') {
        await adapter.shutdown()
      }
    })

    it('should expose all git tools via SDK', async () => {
      const result = await adapter.handleToolsList()

      expect(result.tools.find((t) => t.name === 'git_status')).toBeDefined()
      expect(result.tools.find((t) => t.name === 'git_log')).toBeDefined()
      expect(result.tools.find((t) => t.name === 'git_diff')).toBeDefined()
      expect(result.tools.find((t) => t.name === 'git_commit')).toBeDefined()
      expect(result.tools.find((t) => t.name === 'git_branch')).toBeDefined()
    })

    it('should invoke git tools through SDK', async () => {
      const result = await adapter.handleToolsCall({
        name: 'git_status',
        arguments: { path: '/test/repo' },
      })

      expect(result.content).toBeDefined()
      expect(result.content[0].type).toBe('text')
    })

    it('should validate git tool parameters', async () => {
      await expect(
        adapter.handleToolsCall({
          name: 'git_commit',
          arguments: { path: '/test/repo' }, // missing required 'message'
        })
      ).rejects.toThrow(/message|required/i)
    })

    it('should format git tool results correctly', async () => {
      const result = await adapter.handleToolsCall({
        name: 'git_log',
        arguments: { path: '/test/repo', maxCount: 5 },
      })

      expect(result.content[0].type).toBe('text')
      expect(typeof result.content[0].text).toBe('string')
    })
  })
})

// Helper functions for mock objects
function createMockReadable() {
  return {
    on: vi.fn(),
    read: vi.fn(),
    pipe: vi.fn(),
  }
}

function createMockWritable() {
  return {
    write: vi.fn(),
    end: vi.fn(),
  }
}

function createMockSSERequest() {
  return {
    headers: {
      accept: 'text/event-stream',
    },
    on: vi.fn(),
  }
}

function createMockHTTPRequest(options: { method: string; body: string }) {
  return {
    method: options.method,
    body: options.body,
    headers: {
      'content-type': 'application/json',
    },
  }
}
