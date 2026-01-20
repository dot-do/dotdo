// MCP Server - Model Context Protocol implementation
import { Hono } from 'hono'
import { ToolRegistry } from './discovery'
import { getErrorMessage } from '@dotdo/rpc'

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
  readonly tools: readonly MCPTool[]
  registry?: ToolRegistry
  addTool(tool: MCPTool): void
  fetch: (request: Request) => Promise<Response>
}

export function createMCPServer(options: MCPServerOptions = {}): MCPServer {
  const { name = 'dotdo-mcp', version = '0.0.1', registry } = options
  const toolsArray: MCPTool[] = []
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
      tools: toolsArray.map(t => ({
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

    const tool = toolsArray.find(t => t.name === toolName)
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
  app.get('/', (c) => c.json({ name, version, tools: toolsArray.length }))

  return {
    get tools(): readonly MCPTool[] {
      // Return a defensive copy to prevent direct mutations
      return Object.freeze([...toolsArray])
    },
    registry,
    addTool(tool: MCPTool) {
      toolsArray.push(tool)
      // Also register in registry if provided
      if (registry) {
        registry.register(tool)
      }
    },
    fetch: app.fetch.bind(app)
  }
}
