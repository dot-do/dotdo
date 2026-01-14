/**
 * Example: Vercel Edge API Handler for Durable Objects
 *
 * Place this file at: api/do.ts in your Vercel project
 *
 * @example
 * ```bash
 * # Health check
 * curl https://your-app.vercel.app/do/my-business/health
 *
 * # Create a thing
 * curl -X POST https://your-app.vercel.app/do/my-business/things \
 *   -H "Content-Type: application/json" \
 *   -d '{"name": "Task", "data": {"status": "pending"}}'
 *
 * # Get a thing
 * curl https://your-app.vercel.app/do/my-business/things/task-123
 * ```
 */

import {
  edgeRouter,
  corsMiddleware,
  loggingMiddleware,
  rateLimitMiddleware,
} from '../index'

// Import your DO classes
// In a real project, these would be imported from your objects directory
// import { Business, Agent, Worker } from 'dotdo/objects'

// For this example, we'll create a simple StatelessDO implementation
import type { VercelDoState } from '../do-adapter'
import type { VercelEnv } from '../env.d'

/**
 * Example Business DO class
 * This is a simplified version for demonstration
 */
class Business {
  static readonly $type = 'Business'

  constructor(
    private state: VercelDoState,
    private env: VercelEnv
  ) {}

  async initialize(config: { ns: string }): Promise<void> {
    // Store namespace
    await this.state.storage.put('ns', config.ns)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Health check
    if (path === '/health' || path === '/') {
      return Response.json({
        status: 'ok',
        doId: this.state.id.toString(),
        type: Business.$type,
        region: this.env.VERCEL_REGION,
      })
    }

    // List things
    if (path === '/things' && request.method === 'GET') {
      const things = await this.state.storage.list<unknown>({
        prefix: 'thing:',
      })
      return Response.json({
        items: Array.from(things.entries()).map(([key, value]) => ({
          id: key.replace('thing:', ''),
          ...value as object,
        })),
        count: things.size,
      })
    }

    // Create thing
    if (path === '/things' && request.method === 'POST') {
      const body = await request.json() as { name: string; data?: unknown }
      const id = crypto.randomUUID()

      await this.state.storage.put(`thing:${id}`, {
        name: body.name,
        data: body.data,
        createdAt: new Date().toISOString(),
      })

      return Response.json({ id, ...body }, { status: 201 })
    }

    // Get thing by ID
    const thingMatch = path.match(/^\/things\/([^/]+)$/)
    if (thingMatch && request.method === 'GET') {
      const id = thingMatch[1]
      const thing = await this.state.storage.get(`thing:${id}`)

      if (!thing) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      return Response.json({ id, ...thing as object })
    }

    // Delete thing
    if (thingMatch && request.method === 'DELETE') {
      const id = thingMatch[1]
      const deleted = await this.state.storage.delete(`thing:${id}`)

      if (!deleted) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      return new Response(null, { status: 204 })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

/**
 * Example Agent DO class
 */
class Agent {
  static readonly $type = 'Agent'

  constructor(
    private state: VercelDoState,
    private env: VercelEnv
  ) {}

  async initialize(config: { ns: string }): Promise<void> {
    await this.state.storage.put('ns', config.ns)
    await this.state.storage.put('type', 'Agent')
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({
        status: 'ok',
        doId: this.state.id.toString(),
        type: Agent.$type,
        capabilities: ['chat', 'execute', 'plan'],
      })
    }

    // Chat endpoint
    if (url.pathname === '/chat' && request.method === 'POST') {
      const body = await request.json() as { message: string }

      // Simulated response - in production, this would call an LLM
      return Response.json({
        response: `Echo: ${body.message}`,
        timestamp: new Date().toISOString(),
      })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

/**
 * Vercel Edge Runtime configuration
 */
export const config = {
  runtime: 'edge',
}

/**
 * Edge router handler
 */
export default edgeRouter({
  // Register DO classes by type name
  classes: {
    Business,
    Agent,
  },

  // Default class when type is not specified
  defaultClass: Business,

  // Path pattern for extracting DO ID
  // /do/:id/:path* -> id from second segment
  pathPattern: '/do/:id/:path*',

  // Enable request logging
  logging: true,

  // Middleware chain
  middleware: [
    // CORS for browser requests
    corsMiddleware({
      origins: ['*'], // In production, specify allowed origins
      credentials: true,
    }),

    // Request logging
    loggingMiddleware(),

    // Rate limiting (100 requests per minute per DO)
    rateLimitMiddleware({
      limit: 100,
      window: 60000,
    }),
  ],
})
