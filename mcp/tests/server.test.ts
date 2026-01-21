import { describe, it, expect, beforeEach } from 'vitest'
import { createMCPServer, type MCPServer, type MCPTool } from '../server'
import { ToolRegistry } from '../discovery'

describe('MCP Server', () => {
  let server: MCPServer

  beforeEach(() => {
    server = createMCPServer({ name: 'test-mcp', version: '1.0.0' })
  })

  describe('createMCPServer', () => {
    it('should create a server with empty tools', () => {
      expect(server.tools).toHaveLength(0)
    })

    it('should allow adding tools', () => {
      const tool: MCPTool = {
        name: 'test',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      server.addTool(tool)
      expect(server.tools).toHaveLength(1)
    })

    it('should use default name and version when not provided', async () => {
      const defaultServer = createMCPServer()
      const request = new Request('http://localhost/')
      const response = await defaultServer.fetch(request)
      const json = await response.json()

      expect(json.name).toBe('dotdo-mcp')
      expect(json.version).toBe('0.0.1')
    })

    it('should return frozen tools array to prevent mutations', () => {
      const tool: MCPTool = {
        name: 'test',
        description: 'Test',
        inputSchema: {},
        execute: async () => {}
      }
      server.addTool(tool)

      const tools = server.tools
      expect(Object.isFrozen(tools)).toBe(true)
    })

    it('should return new array on each access to prevent external mutations', () => {
      const tool: MCPTool = {
        name: 'test',
        description: 'Test',
        inputSchema: {},
        execute: async () => {}
      }
      server.addTool(tool)

      const tools1 = server.tools
      const tools2 = server.tools
      expect(tools1).not.toBe(tools2) // Different array references
      expect(tools1).toEqual(tools2) // Same content
    })
  })

  describe('registry integration', () => {
    it('should register tools in registry when provided', () => {
      const registry = new ToolRegistry()
      const serverWithRegistry = createMCPServer({
        name: 'test',
        version: '1.0.0',
        registry
      })

      const tool: MCPTool = {
        name: 'registryTool',
        description: 'A tool that should be in registry',
        inputSchema: {},
        execute: async () => 'result'
      }

      serverWithRegistry.addTool(tool)

      expect(registry.get('registryTool')).toBe(tool)
    })

    it('should expose registry via server.registry', () => {
      const registry = new ToolRegistry()
      const serverWithRegistry = createMCPServer({
        name: 'test',
        version: '1.0.0',
        registry
      })

      expect(serverWithRegistry.registry).toBe(registry)
    })

    it('should have undefined registry when not provided', () => {
      expect(server.registry).toBeUndefined()
    })
  })

  describe('initialize endpoint', () => {
    it('should return protocol version and server info', async () => {
      const request = new Request('http://localhost/mcp/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      expect(json.protocolVersion).toBe('2024-11-05')
      expect(json.serverInfo.name).toBe('test-mcp')
      expect(json.serverInfo.version).toBe('1.0.0')
    })
  })

  describe('tools endpoint', () => {
    it('should list registered tools', async () => {
      server.addTool({
        name: 'search',
        description: 'Search for things',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        execute: async () => []
      })

      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.tools).toHaveLength(1)
      expect(json.tools[0].name).toBe('search')
    })
  })

  describe('call tool endpoint', () => {
    beforeEach(() => {
      server.addTool({
        name: 'add',
        description: 'Add two numbers',
        inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        execute: async (params: any) => params.a + params.b
      })
    })

    it('should call a tool and return result with preserved type', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'add', arguments: { a: 2, b: 3 } })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      // Non-string results use json type with typed data
      expect(json.content[0].type).toBe('json')
      expect(json.content[0].data).toBe(5)
    })

    it('should return error for unknown tool', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'unknown', arguments: {} })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(404)

      const json = await response.json()
      expect(json.isError).toBe(true)
    })

    it('should handle tool execution errors', async () => {
      server.addTool({
        name: 'fail',
        description: 'Always fails',
        inputSchema: {},
        execute: async () => { throw new Error('Intentional failure') }
      })

      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'fail', arguments: {} })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(500)

      const json = await response.json()
      expect(json.isError).toBe(true)
      expect(json.content[0].text).toContain('Intentional failure')
    })
  })

  describe('health check', () => {
    it('should return server info', async () => {
      server.addTool({ name: 't1', description: '', inputSchema: {}, execute: async () => {} })
      server.addTool({ name: 't2', description: '', inputSchema: {}, execute: async () => {} })

      const request = new Request('http://localhost/')
      const response = await server.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.name).toBe('test-mcp')
      expect(json.tools).toBe(2)
    })

    it('should return version in health check', async () => {
      const request = new Request('http://localhost/')
      const response = await server.fetch(request)

      const json = await response.json()
      expect(json.version).toBe('1.0.0')
    })
  })

  describe('initialize endpoint details', () => {
    it('should return tools capability', async () => {
      const request = new Request('http://localhost/mcp/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })

      const response = await server.fetch(request)
      const json = await response.json()

      expect(json.capabilities).toHaveProperty('tools')
    })
  })

  describe('tools endpoint details', () => {
    it('should return empty tools array when no tools registered', async () => {
      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)

      const json = await response.json()
      expect(json.tools).toEqual([])
    })

    it('should not include execute function in tool metadata', async () => {
      server.addTool({
        name: 'test',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        execute: async () => 'secret'
      })

      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)

      const json = await response.json()
      expect(json.tools[0]).not.toHaveProperty('execute')
      expect(json.tools[0].name).toBe('test')
      expect(json.tools[0].description).toBe('Test tool')
      expect(json.tools[0].inputSchema).toEqual({ type: 'object' })
    })

    it('should list multiple tools', async () => {
      server.addTool({ name: 'a', description: 'A', inputSchema: {}, execute: async () => {} })
      server.addTool({ name: 'b', description: 'B', inputSchema: {}, execute: async () => {} })
      server.addTool({ name: 'c', description: 'C', inputSchema: {}, execute: async () => {} })

      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)

      const json = await response.json()
      expect(json.tools).toHaveLength(3)
      expect(json.tools.map((t: {name: string}) => t.name)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('call tool endpoint edge cases', () => {
    it('should handle tool with undefined arguments', async () => {
      server.addTool({
        name: 'noargs',
        description: 'No args tool',
        inputSchema: {},
        execute: async (params: unknown) => ({ received: params })
      })

      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'noargs' }) // No arguments field
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      // Objects use json type with preserved data
      expect(json.content[0].type).toBe('json')
      expect(json.content[0].data.received).toBeUndefined()
    })

    it('should handle tool returning null', async () => {
      server.addTool({
        name: 'nulltool',
        description: 'Returns null',
        inputSchema: {},
        execute: async () => null
      })

      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'nulltool', arguments: {} })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      // null uses json type with preserved null value
      expect(json.content[0].type).toBe('json')
      expect(json.content[0].data).toBe(null)
    })

    it('should handle tool returning string with text type', async () => {
      server.addTool({
        name: 'stringtool',
        description: 'Returns a string',
        inputSchema: {},
        execute: async () => 'Hello, World!'
      })

      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'stringtool', arguments: {} })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      // Strings use text type directly (not double-stringified)
      expect(json.content[0].type).toBe('text')
      expect(json.content[0].text).toBe('Hello, World!')
    })

    it('should handle tool returning complex object with preserved types', async () => {
      server.addTool({
        name: 'complex',
        description: 'Returns complex object',
        inputSchema: {},
        execute: async () => ({
          nested: { value: 42 },
          array: [1, 2, 3],
          boolean: true
        })
      })

      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'complex', arguments: {} })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      // Complex objects use json type with preserved structure
      expect(json.content[0].type).toBe('json')
      const result = json.content[0].data
      expect(result.nested.value).toBe(42)
      expect(result.array).toEqual([1, 2, 3])
      expect(result.boolean).toBe(true)
    })

    it('should include error message in content for execution errors', async () => {
      server.addTool({
        name: 'errorTool',
        description: 'Always errors',
        inputSchema: {},
        execute: async () => { throw new Error('Custom error message') }
      })

      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'errorTool', arguments: {} })
      })

      const response = await server.fetch(request)
      const json = await response.json()

      expect(json.isError).toBe(true)
      expect(json.content[0].type).toBe('text')
      expect(json.content[0].text).toContain('Custom error message')
    })
  })
})
