import { describe, it, expect, beforeEach } from 'vitest'
import { createMCPServer, type MCPServer, type MCPTool } from '../server'

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

    it('should call a tool and return result', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'add', arguments: { a: 2, b: 3 } })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      expect(json.content[0].type).toBe('text')
      expect(JSON.parse(json.content[0].text)).toBe(5)
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
  })
})
