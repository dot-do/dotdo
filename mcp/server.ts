/**
 * MCP Server
 *
 * Main MCP (Model Context Protocol) server implementation using Durable Objects.
 * Extends the McpAgent base class from Cloudflare's agents framework.
 *
 * This server provides:
 * - SSE-based MCP transport
 * - JWT/AuthKit authentication
 * - Permission-based tool access control
 * - Dynamic tool registration
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type {
  McpEnv,
  McpAgentProps,
  McpTool,
  McpToolCall,
  McpToolResult,
  McpCapabilities,
  McpServerInfo,
  McpSseMessage,
  AuthContext,
} from './types'
import { McpErrorCode } from './types'
import {
  authenticateRequest,
  hasAllPermissions,
  handleOAuthCallback,
  handleAuthorizeRequest,
  handleLogoutRequest,
} from './auth'
import { toolRegistry } from './tools'

// ============================================================================
// Types
// ============================================================================

type Variables = {
  auth: AuthContext
  props: McpAgentProps
}

type HonoEnv = {
  Bindings: McpEnv
  Variables: Variables
}

// ============================================================================
// MCP Server Durable Object
// ============================================================================

export class McpServer extends DurableObject<McpEnv> {
  private app: Hono<HonoEnv>
  private serverInfo: McpServerInfo = {
    name: 'dotdo-mcp',
    version: '1.0.0',
  }
  private sseConnections = new Map<string, WritableStreamDefaultWriter<Uint8Array>>()

  constructor(ctx: DurableObjectState, env: McpEnv) {
    super(ctx, env)
    this.app = this.createApp()
  }

  // ==========================================================================
  // App Creation
  // ==========================================================================

  private createApp(): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>()

    // CORS middleware
    app.use('*', cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }))

    // Health check (no auth required)
    app.get('/health', (c) => c.json({ status: 'ok', server: this.serverInfo }))

    // OAuth endpoints (no auth required)
    app.get('/authorize', async (c) => {
      return handleAuthorizeRequest(c.req.raw, this.env)
    })

    app.get('/callback', async (c) => {
      return handleOAuthCallback(c.req.raw, this.env)
    })

    app.post('/logout', async (c) => {
      return handleLogoutRequest(c.req.raw, this.env)
    })

    // Auth middleware for protected routes
    app.use('/sse', async (c, next) => {
      const auth = await authenticateRequest(c.req.raw, this.env)

      if (!auth.authenticated) {
        return c.json(
          { error: McpErrorCode.Unauthorized, message: 'Authentication required' },
          401
        )
      }

      c.set('auth', auth)
      c.set('props', {
        userId: auth.userId!,
        permissions: auth.permissions,
        sessionId: auth.session?.id,
        orgId: auth.jwt?.org_id,
      })

      await next()
    })

    app.use('/tools/*', async (c, next) => {
      const auth = await authenticateRequest(c.req.raw, this.env)

      if (!auth.authenticated) {
        return c.json(
          { error: McpErrorCode.Unauthorized, message: 'Authentication required' },
          401
        )
      }

      c.set('auth', auth)
      c.set('props', {
        userId: auth.userId!,
        permissions: auth.permissions,
        sessionId: auth.session?.id,
        orgId: auth.jwt?.org_id,
      })

      await next()
    })

    // SSE endpoint for MCP communication
    app.get('/sse', async (c) => {
      const props = c.get('props')
      return this.handleSseConnection(c.req.raw, props)
    })

    // Tool listing
    app.get('/tools', (c) => {
      const props = c.get('props')
      const tools = this.getAvailableTools(props.permissions)
      return c.json({ tools })
    })

    // Tool execution
    app.post('/tools/:name', async (c) => {
      const props = c.get('props')
      const toolName = c.req.param('name')
      const body = await c.req.json() as { arguments: Record<string, unknown> }

      const result = await this.executeTool(
        { name: toolName, arguments: body.arguments },
        props
      )

      if (result.isError) {
        return c.json({ error: result }, 400)
      }

      return c.json({ result })
    })

    // Capabilities endpoint
    app.get('/capabilities', (c) => {
      const auth = c.get('auth')
      const capabilities = this.getCapabilities(auth?.permissions || [])
      return c.json(capabilities)
    })

    // 404 handler
    app.notFound((c) => c.json({ error: 'Not Found' }, 404))

    // Error handler
    app.onError((err, c) => {
      console.error('MCP Server error:', err)
      return c.json(
        { error: McpErrorCode.InternalError, message: err.message },
        500
      )
    })

    return app
  }

  // ==========================================================================
  // Fetch Handler
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }

  // ==========================================================================
  // SSE Handling
  // ==========================================================================

  private async handleSseConnection(
    request: Request,
    props: McpAgentProps
  ): Promise<Response> {
    const connectionId = crypto.randomUUID()

    // Create transform stream for SSE
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()

    // Store connection
    this.sseConnections.set(connectionId, writer)

    // Send initial connection message
    const initMessage: McpSseMessage = {
      type: 'initialize',
      serverInfo: this.serverInfo,
      capabilities: this.getCapabilities(props.permissions),
    }
    await this.sendSseMessage(writer, initMessage)

    // Set up heartbeat
    const heartbeat = setInterval(async () => {
      try {
        await this.sendSseMessage(writer, { type: 'ping' })
      } catch {
        clearInterval(heartbeat)
        this.sseConnections.delete(connectionId)
      }
    }, 30000)

    // Clean up on close
    request.signal.addEventListener('abort', () => {
      clearInterval(heartbeat)
      this.sseConnections.delete(connectionId)
      writer.close().catch(() => {})
    })

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Connection-Id': connectionId,
      },
    })
  }

  private async sendSseMessage(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    message: McpSseMessage
  ): Promise<void> {
    const encoder = new TextEncoder()
    const data = `data: ${JSON.stringify(message)}\n\n`
    await writer.write(encoder.encode(data))
  }

  // ==========================================================================
  // Tool Management
  // ==========================================================================

  /**
   * Get tools available to the user based on their permissions
   */
  private getAvailableTools(permissions: string[]): McpTool[] {
    const tools: McpTool[] = []

    for (const tool of toolRegistry.getAll()) {
      // Check if user has required permissions for this tool
      const requiredPermissions = tool.requiredPermissions || []
      if (requiredPermissions.length === 0 || hasAllPermissions(permissions, requiredPermissions)) {
        tools.push(tool)
      }
    }

    return tools
  }

  /**
   * Execute a tool with permission checking
   */
  private async executeTool(
    call: McpToolCall,
    props: McpAgentProps
  ): Promise<McpToolResult> {
    // Get tool from registry
    const tool = toolRegistry.get(call.name)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool '${call.name}' not found` }],
        isError: true,
      }
    }

    // Check permissions
    const requiredPermissions = tool.requiredPermissions || []
    if (requiredPermissions.length > 0 && !hasAllPermissions(props.permissions, requiredPermissions)) {
      return {
        content: [{ type: 'text', text: `Insufficient permissions to execute tool '${call.name}'` }],
        isError: true,
      }
    }

    // Execute tool handler
    try {
      const handler = toolRegistry.getHandler(call.name)
      if (!handler) {
        return {
          content: [{ type: 'text', text: `No handler registered for tool '${call.name}'` }],
          isError: true,
        }
      }

      const result = await handler(call.arguments, props, this.env)
      return result
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Tool execution failed: ${(err as Error).message}` }],
        isError: true,
      }
    }
  }

  // ==========================================================================
  // Capabilities
  // ==========================================================================

  private getCapabilities(permissions: string[]): McpCapabilities {
    const tools: Record<string, McpTool> = {}

    for (const tool of this.getAvailableTools(permissions)) {
      tools[tool.name] = tool
    }

    return {
      tools,
      resources: {},
      prompts: {},
    }
  }

  // ==========================================================================
  // RPC Methods (callable from worker)
  // ==========================================================================

  /**
   * Get server info
   */
  getServerInfo(): McpServerInfo {
    return this.serverInfo
  }

  /**
   * Register a new tool
   */
  registerTool(
    tool: McpTool,
    handler: (
      args: Record<string, unknown>,
      props: McpAgentProps,
      env: McpEnv
    ) => Promise<McpToolResult>
  ): void {
    toolRegistry.register(tool, handler)
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    return toolRegistry.unregister(name)
  }

  /**
   * Get active SSE connection count
   */
  getConnectionCount(): number {
    return this.sseConnections.size
  }

  /**
   * Broadcast message to all connected clients
   */
  async broadcast(message: McpSseMessage): Promise<number> {
    let sent = 0

    for (const [id, writer] of this.sseConnections) {
      try {
        await this.sendSseMessage(writer, message)
        sent++
      } catch {
        // Connection closed, remove it
        this.sseConnections.delete(id)
      }
    }

    return sent
  }
}
