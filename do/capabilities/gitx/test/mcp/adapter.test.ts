import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MCPAdapter,
  MCPServerConfig,
  MCPRequest,
  MCPResponse,
  MCPErrorCode,
  MCPError,
  createMCPAdapter,
  MCPCapability,
  MCPToolInfo,
  MCPResourceInfo,
  MCPPromptInfo,
} from '../../src/mcp/adapter'

describe('MCP SDK Adapter', () => {
  describe('MCPAdapter initialization', () => {
    it('should create adapter with default config', () => {
      const adapter = createMCPAdapter()
      expect(adapter).toBeDefined()
      expect(adapter).toBeInstanceOf(MCPAdapter)
    })

    it('should create adapter with custom config', () => {
      const config: MCPServerConfig = {
        name: 'gitx.do-mcp-server',
        version: '1.0.0',
        capabilities: ['tools', 'resources'],
      }
      const adapter = createMCPAdapter(config)
      expect(adapter).toBeDefined()
      expect(adapter.getConfig().name).toBe('gitx.do-mcp-server')
      expect(adapter.getConfig().version).toBe('1.0.0')
    })

    it('should have default server name if not provided', () => {
      const adapter = createMCPAdapter()
      expect(adapter.getConfig().name).toBe('gitx.do')
    })

    it('should have default version if not provided', () => {
      const adapter = createMCPAdapter()
      expect(adapter.getConfig().version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should support tools capability by default', () => {
      const adapter = createMCPAdapter()
      expect(adapter.hasCapability('tools')).toBe(true)
    })

    it('should not be initialized until start() is called', () => {
      const adapter = createMCPAdapter()
      expect(adapter.isInitialized()).toBe(false)
    })

    it('should be initialized after start() is called', async () => {
      const adapter = createMCPAdapter()
      await adapter.start()
      expect(adapter.isInitialized()).toBe(true)
    })

    it('should throw if start() is called twice', async () => {
      const adapter = createMCPAdapter()
      await adapter.start()
      await expect(adapter.start()).rejects.toThrow(/already initialized|started/i)
    })

    it('should properly shut down with stop()', async () => {
      const adapter = createMCPAdapter()
      await adapter.start()
      await adapter.stop()
      expect(adapter.isInitialized()).toBe(false)
    })

    it('should throw if stop() is called before start()', async () => {
      const adapter = createMCPAdapter()
      await expect(adapter.stop()).rejects.toThrow(/not initialized|not started/i)
    })
  })

  describe('Tool registration', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    it('should register a tool with name and schema', () => {
      const toolInfo: MCPToolInfo = {
        name: 'git_status',
        description: 'Get the status of the git repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
          },
        },
        handler: async () => ({ content: [{ type: 'text', text: 'status output' }] }),
      }

      expect(() => adapter.registerTool(toolInfo)).not.toThrow()
    })

    it('should throw when registering tool with duplicate name', () => {
      const tool: MCPToolInfo = {
        name: 'duplicate_tool',
        description: 'First tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      adapter.registerTool(tool)

      expect(() => adapter.registerTool(tool)).toThrow(/already registered|duplicate/i)
    })

    it('should list all registered tools', () => {
      adapter.registerTool({
        name: 'tool_1',
        description: 'Tool 1',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })
      adapter.registerTool({
        name: 'tool_2',
        description: 'Tool 2',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      const tools = adapter.listTools()
      expect(tools).toHaveLength(2)
      expect(tools.map((t) => t.name)).toContain('tool_1')
      expect(tools.map((t) => t.name)).toContain('tool_2')
    })

    it('should not include handler in listed tools', () => {
      adapter.registerTool({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      const tools = adapter.listTools()
      expect(tools[0]).not.toHaveProperty('handler')
    })

    it('should get tool by name', () => {
      adapter.registerTool({
        name: 'my_tool',
        description: 'My tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      const tool = adapter.getTool('my_tool')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('my_tool')
    })

    it('should return undefined for non-existent tool', () => {
      const tool = adapter.getTool('nonexistent')
      expect(tool).toBeUndefined()
    })

    it('should unregister a tool by name', () => {
      adapter.registerTool({
        name: 'removable_tool',
        description: 'A removable tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      })

      expect(adapter.getTool('removable_tool')).toBeDefined()
      adapter.unregisterTool('removable_tool')
      expect(adapter.getTool('removable_tool')).toBeUndefined()
    })

    it('should throw when unregistering non-existent tool', () => {
      expect(() => adapter.unregisterTool('nonexistent')).toThrow(/not found|does not exist/i)
    })

    it('should register multiple git tools from gitTools array', () => {
      adapter.registerGitTools()
      const tools = adapter.listTools()
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.map((t) => t.name)).toContain('git_status')
      expect(tools.map((t) => t.name)).toContain('git_log')
      expect(tools.map((t) => t.name)).toContain('git_diff')
    })
  })

  describe('MCP request handling', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    describe('initialize request', () => {
      it('should handle initialize request', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.result).toBeDefined()
        expect(response.result.protocolVersion).toBeDefined()
        expect(response.result.serverInfo).toBeDefined()
        expect(response.result.serverInfo.name).toBe('gitx.do')
      })

      it('should return capabilities in initialize response', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.result.capabilities).toBeDefined()
        expect(response.result.capabilities.tools).toBeDefined()
      })

      it('should negotiate protocol version', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.result.protocolVersion).toBe('2024-11-05')
      })
    })

    describe('tools/list request', () => {
      it('should handle tools/list request', async () => {
        adapter.registerTool({
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })

        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }

        const response = await adapter.handleRequest(request)
        expect(response.result).toBeDefined()
        expect(response.result.tools).toBeDefined()
        expect(Array.isArray(response.result.tools)).toBe(true)
        expect(response.result.tools.length).toBe(1)
        expect(response.result.tools[0].name).toBe('test_tool')
      })

      it('should include tool schema in tools/list response', async () => {
        adapter.registerTool({
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string', description: 'First param' },
            },
            required: ['param1'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })

        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }

        const response = await adapter.handleRequest(request)
        expect(response.result.tools[0].inputSchema).toBeDefined()
        expect(response.result.tools[0].inputSchema.properties.param1).toBeDefined()
      })

      it('should return empty tools array when no tools registered', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }

        const response = await adapter.handleRequest(request)
        expect(response.result.tools).toEqual([])
      })
    })

    describe('tools/call request', () => {
      beforeEach(() => {
        adapter.registerTool({
          name: 'echo_tool',
          description: 'Echoes input',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          handler: async (params) => ({
            content: [{ type: 'text', text: `Echo: ${params.message}` }],
          }),
        })
      })

      it('should handle tools/call request', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'echo_tool',
            arguments: { message: 'Hello, World!' },
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.result).toBeDefined()
        expect(response.result.content).toBeDefined()
        expect(response.result.content[0].text).toBe('Echo: Hello, World!')
      })

      it('should validate required parameters', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'echo_tool',
            arguments: {}, // missing required 'message'
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.error).toBeDefined()
        expect(response.error.code).toBe(MCPErrorCode.INVALID_PARAMS)
      })

      it('should return error for non-existent tool', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.error).toBeDefined()
        expect(response.error.code).toBe(MCPErrorCode.METHOD_NOT_FOUND)
      })

      it('should handle tool execution errors gracefully', async () => {
        adapter.registerTool({
          name: 'failing_tool',
          description: 'A tool that fails',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            throw new Error('Tool execution failed')
          },
        })

        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'failing_tool',
            arguments: {},
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.result).toBeDefined()
        expect(response.result.isError).toBe(true)
        expect(response.result.content[0].text).toContain('Tool execution failed')
      })
    })

    describe('unknown method handling', () => {
      it('should return error for unknown method', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 4,
          method: 'unknown/method',
          params: {},
        }

        const response = await adapter.handleRequest(request)
        expect(response.error).toBeDefined()
        expect(response.error.code).toBe(MCPErrorCode.METHOD_NOT_FOUND)
      })
    })

    describe('notification handling', () => {
      it('should handle notifications (requests without id)', async () => {
        const notification: MCPRequest = {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }

        // Notifications should not return a response
        const response = await adapter.handleRequest(notification)
        expect(response).toBeUndefined()
      })

      it('should handle cancelled notification', async () => {
        const notification: MCPRequest = {
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: {
            requestId: 123,
            reason: 'User cancelled',
          },
        }

        const response = await adapter.handleRequest(notification)
        expect(response).toBeUndefined()
      })
    })
  })

  describe('MCP response formatting', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    it('should format successful response with result', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe(1)
      expect(response.result).toBeDefined()
      expect(response.error).toBeUndefined()
    })

    it('should format error response with error object', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown/method',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      expect(response.jsonrpc).toBe('2.0')
      expect(response.id).toBe(1)
      expect(response.result).toBeUndefined()
      expect(response.error).toBeDefined()
      expect(response.error.code).toBeDefined()
      expect(response.error.message).toBeDefined()
    })

    it('should preserve request id in response', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 'custom-id-123',
        method: 'tools/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      expect(response.id).toBe('custom-id-123')
    })

    it('should format text content correctly', async () => {
      adapter.registerTool({
        name: 'text_tool',
        description: 'Returns text',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
          content: [{ type: 'text', text: 'Hello, World!' }],
        }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'text_tool', arguments: {} },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.content[0].type).toBe('text')
      expect(response.result.content[0].text).toBe('Hello, World!')
    })

    it('should format multiple content items', async () => {
      adapter.registerTool({
        name: 'multi_content_tool',
        description: 'Returns multiple content items',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
          content: [
            { type: 'text', text: 'First' },
            { type: 'text', text: 'Second' },
            { type: 'text', text: 'Third' },
          ],
        }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'multi_content_tool', arguments: {} },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.content).toHaveLength(3)
    })

    it('should format image content correctly', async () => {
      adapter.registerTool({
        name: 'image_tool',
        description: 'Returns an image',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
          content: [{ type: 'image', data: 'base64imagedata', mimeType: 'image/png' }],
        }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'image_tool', arguments: {} },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.content[0].type).toBe('image')
      expect(response.result.content[0].data).toBe('base64imagedata')
      expect(response.result.content[0].mimeType).toBe('image/png')
    })

    it('should format resource content correctly', async () => {
      adapter.registerTool({
        name: 'resource_tool',
        description: 'Returns a resource',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
          content: [
            {
              type: 'resource',
              data: 'resourcedata',
              mimeType: 'application/octet-stream',
            },
          ],
        }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'resource_tool', arguments: {} },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.content[0].type).toBe('resource')
    })

    it('should include isError flag when tool reports error', async () => {
      adapter.registerTool({
        name: 'error_reporting_tool',
        description: 'Reports an error via isError',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
          content: [{ type: 'text', text: 'Something went wrong' }],
          isError: true,
        }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'error_reporting_tool', arguments: {} },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.isError).toBe(true)
    })
  })

  describe('MCP error handling and error codes', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    describe('JSON-RPC standard error codes', () => {
      it('should return PARSE_ERROR (-32700) for invalid JSON', async () => {
        // This tests parsing raw input rather than request objects
        const response = await adapter.handleRawRequest('not valid json')
        expect(response.error.code).toBe(MCPErrorCode.PARSE_ERROR)
        expect(response.error.code).toBe(-32700)
      })

      it('should return INVALID_REQUEST (-32600) for malformed request', async () => {
        const malformedRequest = {
          // missing jsonrpc version
          id: 1,
          method: 'tools/list',
        }

        const response = await adapter.handleRequest(malformedRequest as MCPRequest)
        expect(response.error.code).toBe(MCPErrorCode.INVALID_REQUEST)
        expect(response.error.code).toBe(-32600)
      })

      it('should return METHOD_NOT_FOUND (-32601) for unknown method', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'nonexistent/method',
          params: {},
        }

        const response = await adapter.handleRequest(request)
        expect(response.error.code).toBe(MCPErrorCode.METHOD_NOT_FOUND)
        expect(response.error.code).toBe(-32601)
      })

      it('should return INVALID_PARAMS (-32602) for invalid parameters', async () => {
        adapter.registerTool({
          name: 'typed_tool',
          description: 'Tool with required params',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
            },
            required: ['count'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })

        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'typed_tool',
            arguments: { count: 'not a number' },
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.error.code).toBe(MCPErrorCode.INVALID_PARAMS)
        expect(response.error.code).toBe(-32602)
      })

      it('should return INTERNAL_ERROR (-32603) for server errors', async () => {
        // Force an internal error by mocking
        const originalListTools = adapter.listTools.bind(adapter)
        adapter.listTools = () => {
          throw new Error('Internal server error')
        }

        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }

        const response = await adapter.handleRequest(request)
        expect(response.error.code).toBe(MCPErrorCode.INTERNAL_ERROR)
        expect(response.error.code).toBe(-32603)

        // Restore
        adapter.listTools = originalListTools
      })
    })

    describe('MCP-specific error codes', () => {
      it('should have RESOURCE_NOT_FOUND error code', () => {
        expect(MCPErrorCode.RESOURCE_NOT_FOUND).toBeDefined()
        expect(MCPErrorCode.RESOURCE_NOT_FOUND).toBeLessThan(-32000)
      })

      it('should have TOOL_NOT_FOUND error code', () => {
        expect(MCPErrorCode.TOOL_NOT_FOUND).toBeDefined()
      })

      it('should have PROMPT_NOT_FOUND error code', () => {
        expect(MCPErrorCode.PROMPT_NOT_FOUND).toBeDefined()
      })

      it('should have CAPABILITY_NOT_SUPPORTED error code', () => {
        expect(MCPErrorCode.CAPABILITY_NOT_SUPPORTED).toBeDefined()
      })

      it('should return TOOL_NOT_FOUND when calling non-existent tool', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'definitely_not_a_tool',
            arguments: {},
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.error.code).toBe(MCPErrorCode.TOOL_NOT_FOUND)
      })
    })

    describe('MCPError class', () => {
      it('should create MCPError with code and message', () => {
        const error = new MCPError(MCPErrorCode.INVALID_PARAMS, 'Invalid parameters')
        expect(error.code).toBe(MCPErrorCode.INVALID_PARAMS)
        expect(error.message).toBe('Invalid parameters')
      })

      it('should be an instance of Error', () => {
        const error = new MCPError(MCPErrorCode.INTERNAL_ERROR, 'Something went wrong')
        expect(error).toBeInstanceOf(Error)
      })

      it('should support optional data property', () => {
        const error = new MCPError(MCPErrorCode.INVALID_PARAMS, 'Invalid', {
          field: 'count',
          expected: 'number',
        })
        expect(error.data).toEqual({ field: 'count', expected: 'number' })
      })

      it('should serialize to JSON-RPC error format', () => {
        const error = new MCPError(MCPErrorCode.INVALID_PARAMS, 'Invalid params')
        const json = error.toJSON()
        expect(json).toEqual({
          code: MCPErrorCode.INVALID_PARAMS,
          message: 'Invalid params',
        })
      })

      it('should include data in JSON when present', () => {
        const error = new MCPError(MCPErrorCode.INVALID_PARAMS, 'Invalid params', {
          details: 'extra info',
        })
        const json = error.toJSON()
        expect(json.data).toEqual({ details: 'extra info' })
      })
    })

    describe('Error message formatting', () => {
      it('should include descriptive error message', async () => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.error.message).toMatch(/unknown_tool|not found|does not exist/i)
      })

      it('should include validation details in error', async () => {
        adapter.registerTool({
          name: 'validated_tool',
          description: 'Tool with validation',
          inputSchema: {
            type: 'object',
            properties: {
              email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
            },
            required: ['email'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        })

        const request: MCPRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'validated_tool',
            arguments: { email: 'not-an-email' },
          },
        }

        const response = await adapter.handleRequest(request)
        expect(response.error).toBeDefined()
        expect(response.error.message).toMatch(/email|pattern|invalid/i)
      })
    })
  })

  describe('Transport handling', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter()
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    it('should handle request from JSON string', async () => {
      const jsonRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      })

      const response = await adapter.handleRawRequest(jsonRequest)
      expect(response.result).toBeDefined()
    })

    it('should return JSON string from handleRawRequest', async () => {
      const jsonRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      })

      const response = await adapter.handleRawRequest(jsonRequest)
      expect(typeof response).toBe('object')
      expect(response.jsonrpc).toBe('2.0')
    })

    it('should handle batch requests', async () => {
      const batchRequest = [
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ]

      const responses = await adapter.handleBatchRequest(batchRequest)
      expect(Array.isArray(responses)).toBe(true)
      expect(responses).toHaveLength(2)
      expect(responses[0].id).toBe(1)
      expect(responses[1].id).toBe(2)
    })

    it('should filter out notifications from batch response', async () => {
      const batchRequest = [
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, // notification, no id
      ]

      const responses = await adapter.handleBatchRequest(batchRequest)
      expect(responses).toHaveLength(1)
      expect(responses[0].id).toBe(1)
    })
  })

  describe('Capability negotiation', () => {
    it('should support configuring capabilities', () => {
      const adapter = createMCPAdapter({
        capabilities: ['tools', 'resources', 'prompts'],
      })

      expect(adapter.hasCapability('tools')).toBe(true)
      expect(adapter.hasCapability('resources')).toBe(true)
      expect(adapter.hasCapability('prompts')).toBe(true)
    })

    it('should not support unconfigured capabilities', () => {
      const adapter = createMCPAdapter({
        capabilities: ['tools'],
      })

      expect(adapter.hasCapability('tools')).toBe(true)
      expect(adapter.hasCapability('resources')).toBe(false)
    })

    it('should return error when calling disabled capability', async () => {
      const adapter = createMCPAdapter({
        capabilities: ['tools'], // resources disabled
      })
      await adapter.start()

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      expect(response.error).toBeDefined()
      expect(response.error.code).toBe(MCPErrorCode.CAPABILITY_NOT_SUPPORTED)

      await adapter.stop()
    })
  })

  describe('Resources support', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter({ capabilities: ['tools', 'resources'] })
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    it('should register a resource', () => {
      const resource: MCPResourceInfo = {
        uri: 'git://repo/file.txt',
        name: 'file.txt',
        mimeType: 'text/plain',
      }

      expect(() => adapter.registerResource(resource)).not.toThrow()
    })

    it('should list registered resources', async () => {
      adapter.registerResource({
        uri: 'git://repo/file1.txt',
        name: 'file1.txt',
        mimeType: 'text/plain',
      })
      adapter.registerResource({
        uri: 'git://repo/file2.txt',
        name: 'file2.txt',
        mimeType: 'text/plain',
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.resources).toHaveLength(2)
    })

    it('should read a resource', async () => {
      adapter.registerResource({
        uri: 'git://repo/file.txt',
        name: 'file.txt',
        mimeType: 'text/plain',
        handler: async () => ({ content: 'File contents here' }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'git://repo/file.txt' },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.contents).toBeDefined()
    })
  })

  describe('Prompts support', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter({ capabilities: ['tools', 'prompts'] })
      await adapter.start()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    it('should register a prompt', () => {
      const prompt: MCPPromptInfo = {
        name: 'commit_message',
        description: 'Generate a commit message',
        arguments: [{ name: 'diff', description: 'The diff to analyze', required: true }],
      }

      expect(() => adapter.registerPrompt(prompt)).not.toThrow()
    })

    it('should list registered prompts', async () => {
      adapter.registerPrompt({
        name: 'prompt1',
        description: 'First prompt',
      })
      adapter.registerPrompt({
        name: 'prompt2',
        description: 'Second prompt',
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.prompts).toHaveLength(2)
    })

    it('should get a prompt with arguments', async () => {
      adapter.registerPrompt({
        name: 'greeting',
        description: 'Generate a greeting',
        arguments: [{ name: 'name', required: true }],
        handler: async (args) => ({
          messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${args.name}!` } }],
        }),
      })

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: { name: 'greeting', arguments: { name: 'World' } },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result.messages).toBeDefined()
      expect(response.result.messages[0].content.text).toBe('Hello, World!')
    })
  })

  describe('Integration with git tools module', () => {
    let adapter: MCPAdapter

    beforeEach(async () => {
      adapter = createMCPAdapter()
      await adapter.start()
      adapter.registerGitTools()
    })

    afterEach(async () => {
      if (adapter.isInitialized()) {
        await adapter.stop()
      }
    })

    it('should expose git_status via MCP', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      const tools = response.result.tools
      expect(tools.find((t: { name: string }) => t.name === 'git_status')).toBeDefined()
    })

    it('should invoke git_status via tools/call', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'git_status',
          arguments: { path: '/test/repo' },
        },
      }

      const response = await adapter.handleRequest(request)
      expect(response.result).toBeDefined()
      expect(response.result.content).toBeDefined()
    })

    it('should expose all 9 git tools', async () => {
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }

      const response = await adapter.handleRequest(request)
      const tools = response.result.tools
      const expectedTools = [
        'git_status',
        'git_log',
        'git_diff',
        'git_commit',
        'git_branch',
        'git_checkout',
        'git_push',
        'git_pull',
        'git_clone',
      ]

      for (const toolName of expectedTools) {
        expect(tools.find((t: { name: string }) => t.name === toolName)).toBeDefined()
      }
    })
  })
})
