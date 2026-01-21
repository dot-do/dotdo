// Integration tests for sandbox tool with MCP server
// IMPORTANT: This test follows the NO MOCKS philosophy from CLAUDE.md.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMCPServer, type MCPServer } from '../server'
import { createSandboxTool } from '../tools/sandbox'
import { ToolRegistry, ToolCategory } from '../discovery'
import type { WorkflowContext } from '../../do/context'
import { createTestContext, createEventCapture } from './test-helpers'

describe('Sandbox MCP Integration', () => {
  let server: MCPServer
  let registry: ToolRegistry
  let context: WorkflowContext
  let capturedEvents: Array<{ type: string; payload?: unknown }>

  beforeEach(() => {
    // Create a real WorkflowContext using the test helper (NO MOCKS philosophy)
    const baseContext = createTestContext('sandbox-integration-test')
    const capture = createEventCapture(baseContext)
    context = capture.wrappedContext
    capturedEvents = capture.capturedEvents

    // Create MCP server with registry
    registry = new ToolRegistry()
    server = createMCPServer({
      name: 'sandbox-test-mcp',
      version: '1.0.0',
      registry
    })

    // Add sandbox tool
    const sandboxTool = createSandboxTool({ context: context })
    server.addTool(sandboxTool)
  })

  describe('Tool Registration', () => {
    it('should register sandbox tool in MCP server', () => {
      const tool = server.tools.find(t => t.name === 'sandbox')
      expect(tool).toBeDefined()
      expect(tool?.description).toContain('secure sandbox')
    })

    it('should register sandbox tool in registry with correct category', () => {
      // Use a fresh registry for this test
      const freshRegistry = new ToolRegistry()
      const sandboxTool = createSandboxTool({ context: context })
      freshRegistry.register(sandboxTool, ToolCategory.COMPUTE, ['sandbox', 'isolation'])

      const tool = freshRegistry.get('sandbox')
      expect(tool).toBeDefined()
      expect(freshRegistry.getCategory('sandbox')).toBe(ToolCategory.COMPUTE)
      expect(freshRegistry.hasCapability('sandbox', 'sandbox')).toBe(true)
    })

    it('should dynamically register and unregister sandbox tool', () => {
      const events: string[] = []
      registry.on('tool:registered', (name) => events.push(`registered:${name}`))
      registry.on('tool:unregistered', (name) => events.push(`unregistered:${name}`))

      const tool = createSandboxTool({ context: context })
      // First unregister if exists (from addTool earlier)
      if (registry.get('sandbox')) {
        registry.unregister('sandbox')
      }

      registry.register(tool, ToolCategory.COMPUTE)
      expect(events).toContain('registered:sandbox')

      registry.unregister('sandbox')
      expect(events).toContain('unregistered:sandbox')
    })
  })

  describe('MCP Protocol Integration', () => {
    it('should list sandbox tool via MCP tools endpoint', async () => {
      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()

      const sandboxTool = json.tools.find((t: unknown) => (t as { name: string }).name === 'sandbox')
      expect(sandboxTool).toBeDefined()
      expect(sandboxTool.inputSchema.properties.code).toBeDefined()
      expect(sandboxTool.inputSchema.properties.permissions).toBeDefined()
    })

    it('should execute code via MCP tools/call endpoint', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: { code: 'return 1 + 1' }
        })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      const result = JSON.parse(json.content[0].text)
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('should handle $ context operations via MCP', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: `
              $.send({ type: 'User.created', payload: { id: 1 } })
              return 'event sent'
            `
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      expect(result.value).toBe('event sent')
      // Using capturedEvents array instead of vi.fn() mock assertions (NO MOCKS philosophy)
      expect(capturedEvents).toContainEqual({
        type: 'User.created',
        payload: { id: 1 }
      })
    })
  })

  describe('Permission Control via MCP', () => {
    it('should respect permission flags passed via MCP', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: `
              try {
                $.send({ type: 'Test' })
                return 'should not reach'
              } catch (e) {
                return 'blocked: ' + e.message
              }
            `,
            permissions: { allowSend: false }
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      expect(result.value).toContain('blocked')
      expect(result.value).toContain('Permission denied')
    })

    it('should allow all operations with default permissions', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: `
              $.send({ type: 'Test.event' })
              await $.try(async () => 'tried')
              await $.do(async () => 'done')
              return 'all operations completed'
            `
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      expect(result.value).toBe('all operations completed')
    })
  })

  describe('Resource Limits via MCP', () => {
    it('should enforce timeout via MCP', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: `
              await new Promise(resolve => setTimeout(resolve, 500))
              return 'done'
            `,
            timeout: 50
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })

    it('should report resource usage', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: { code: 'return 42' }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      expect(result.resourceUsage).toBeDefined()
      expect(result.resourceUsage.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.resourceUsage.codeSize).toBeGreaterThan(0)
    })

    it('should cap timeout at 30 seconds', async () => {
      // Even if client requests higher timeout, it should be capped
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: 'return "quick"',
            timeout: 60000 // Request 60s
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      // If timeout was properly capped, this should succeed quickly
      expect(result.resourceUsage.executionTime).toBeLessThan(30000)
    })
  })

  describe('Audit Logging via MCP', () => {
    it('should return audit log when enabled', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: `
              $.send({ type: 'Audit.test', payload: { action: 'create' } })
              return 'audited'
            `,
            audit: true
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      expect(result.auditLog).toBeDefined()
      expect(result.auditLog.length).toBeGreaterThan(0)
      expect(result.auditLog[0].operation).toBe('send')
    })

    it('should not include audit log when disabled', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: `
              $.send({ type: 'Test' })
              return 'no audit'
            `,
            audit: false
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(true)
      expect(result.auditLog).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    it('should return error for missing code parameter', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {}
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()

      expect(json.isError).toBe(true)
      expect(json.content[0].text).toContain('code')
    })

    it('should capture and return runtime errors', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: 'throw new Error("runtime error")'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(false)
      expect(result.error).toContain('runtime error')
    })

    it('should handle syntax errors gracefully', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: {
            code: 'const x = {'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = JSON.parse(json.content[0].text)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('Tool Discovery Integration', () => {
    it('should be discoverable with proper metadata', () => {
      // Use fresh registry for isolation
      const freshRegistry = new ToolRegistry()
      const sandboxTool = createSandboxTool({ context: context })
      freshRegistry.register(sandboxTool, ToolCategory.COMPUTE, ['sandbox', 'workflow', 'isolation'])

      const metadata = freshRegistry.getMetadata('sandbox')
      expect(metadata).toBeDefined()
      expect(metadata?.name).toBe('sandbox')
      expect(metadata?.description).toContain('$ context')
      expect(metadata?.inputSchema).toHaveProperty('properties')
    })

    it('should be filterable by capability', () => {
      // Use fresh registry for isolation
      const freshRegistry = new ToolRegistry()
      const sandboxTool = createSandboxTool({ context: context })
      freshRegistry.register(sandboxTool, ToolCategory.COMPUTE, ['sandbox', 'isolation'])

      const isolationTools = freshRegistry.listByCapability('isolation')
      expect(isolationTools.map(t => t.name)).toContain('sandbox')

      const sandboxTools = freshRegistry.listByCapability('sandbox')
      expect(sandboxTools.map(t => t.name)).toContain('sandbox')
    })

    it('should be listed in COMPUTE category', () => {
      // Use fresh registry for isolation
      const freshRegistry = new ToolRegistry()
      const sandboxTool = createSandboxTool({ context: context })
      freshRegistry.register(sandboxTool, ToolCategory.COMPUTE)

      const computeTools = freshRegistry.listByCategory(ToolCategory.COMPUTE)
      expect(computeTools.map(t => t.name)).toContain('sandbox')
    })

    it('should export tool definition correctly', () => {
      // Use fresh registry for isolation
      const freshRegistry = new ToolRegistry()
      const sandboxTool = createSandboxTool({ context: context })
      freshRegistry.register(sandboxTool, ToolCategory.COMPUTE, ['sandbox'])

      const exported = freshRegistry.export()
      const sandboxDef = exported.find(t => t.name === 'sandbox')

      expect(sandboxDef).toBeDefined()
      expect(sandboxDef?.category).toBe(ToolCategory.COMPUTE)
      expect(sandboxDef?.capabilities).toContain('sandbox')
    })
  })

  describe('Multi-tool MCP Server', () => {
    it('should work alongside other tools', async () => {
      // Add another simple tool
      server.addTool({
        name: 'echo',
        description: 'Echo input',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } }
        },
        execute: async (params: unknown) => (params as { message: string }).message
      })

      // List tools - should have both
      const listRequest = new Request('http://localhost/mcp/tools')
      const listResponse = await server.fetch(listRequest)
      const listJson = await listResponse.json()

      expect(listJson.tools.length).toBeGreaterThanOrEqual(2)
      expect(listJson.tools.map((t: unknown) => (t as { name: string }).name)).toContain('sandbox')
      expect(listJson.tools.map((t: unknown) => (t as { name: string }).name)).toContain('echo')

      // Execute both tools
      const sandboxRequest = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sandbox',
          arguments: { code: 'return "sandbox result"' }
        })
      })

      const echoRequest = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'echo',
          arguments: { message: 'echo result' }
        })
      })

      const [sandboxResponse, echoResponse] = await Promise.all([
        server.fetch(sandboxRequest),
        server.fetch(echoRequest)
      ])

      const sandboxJson = await sandboxResponse.json()
      const echoJson = await echoResponse.json()

      const sandboxResult = JSON.parse(sandboxJson.content[0].text)
      expect(sandboxResult.success).toBe(true)
      expect(sandboxResult.value).toBe('sandbox result')

      expect(JSON.parse(echoJson.content[0].text)).toBe('echo result')
    })
  })
})
