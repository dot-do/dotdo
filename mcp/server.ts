// MCP Server - Model Context Protocol implementation
import { Hono } from 'hono'
import { ToolRegistry } from './discovery'
import { getErrorMessage } from '../rpc/errors'

export interface MCPServerOptions {
  name?: string
  version?: string
  registry?: ToolRegistry
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: object
  execute: (params: unknown) => Promise<unknown>
}

export interface MCPServer {
  tools: MCPTool[]
  registry?: ToolRegistry
  addTool(tool: MCPTool): void
  fetch: (request: Request, env?: unknown, ctx?: ExecutionContext) => Response | Promise<Response>
}

export function createMCPServer(options: MCPServerOptions = {}): MCPServer {
  const { name = 'dotdo-mcp', version = '0.0.1', registry } = options
  const tools: MCPTool[] = []
  const app = new Hono()

  // MCP Protocol endpoints

  // Initialize - return server info
  app.post('/mcp/initialize', async (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name,
        version
      }
    })
  })

  // List tools
  app.get('/mcp/tools', async (c) => {
    return c.json({
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }))
    })
  })

  // Call tool
  app.post('/mcp/tools/call', async (c) => {
    const { name: toolName, arguments: args } = await c.req.json<{
      name: string
      arguments?: unknown
    }>()

    const tool = tools.find(t => t.name === toolName)
    if (!tool) {
      return c.json({
        isError: true,
        content: [{ type: 'text', text: `Tool not found: ${toolName}` }]
      }, 404)
    }

    try {
      const result = await tool.execute(args)
      return c.json({
        content: [{ type: 'text', text: JSON.stringify(result) }]
      })
    } catch (error) {
      return c.json({
        isError: true,
        content: [{ type: 'text', text: getErrorMessage(error) }]
      }, 500)
    }
  })

  // Health check
  app.get('/', (c) => c.json({ name, version, tools: tools.length }))

  return {
    tools,
    registry,
    addTool(tool: MCPTool) {
      tools.push(tool)
      // Also register in registry if provided
      if (registry) {
        registry.register(tool)
      }
    },
    fetch: app.fetch.bind(app)
  }
}
