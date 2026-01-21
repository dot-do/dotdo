/**
 * Benchmark Durable Object Classes
 *
 * These DO classes are exported for vitest-pool-workers to instantiate
 * during miniflare benchmark testing. They provide a realistic RPC target
 * for measuring actual latency.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

interface Env {
  DO: DurableObjectNamespace
}

/**
 * Benchmark DO that exposes RPC methods for benchmarking real latency
 */
export class BenchDO implements DurableObject {
  private state: DurableObjectState
  private app: Hono
  private counter = 0

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
    this.app = new Hono()
    this.setupRoutes()
  }

  private setupRoutes(): void {
    // CORS for all routes
    this.app.use('*', cors())

    // Health check
    this.app.get('/', (c) => c.json({ status: 'ok', id: this.state.id.toString() }))

    // RPC endpoint
    this.app.post('/rpc', async (c) => {
      const body = await c.req.json<{ method: string; args: unknown[] }>()
      const { method, args } = body

      try {
        const result = await this.handleRPC(method, args)
        return c.json(result)
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          500
        )
      }
    })
  }

  private async handleRPC(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { result: 'ok' }

      case 'echo':
        return { result: args[0] }

      case 'createUser':
        // Simulate user creation with data processing
        const user = args[0] as Record<string, unknown>
        return { id: `user-${Date.now()}`, ...user }

      case 'process':
        // Simple processing
        return { result: 'processed', index: args[0] }

      case 'listItems':
        // Return a large response
        return {
          items: Array.from({ length: 100 }, (_, i) => ({
            id: `item-${i}`,
            name: `Item ${i}`,
            data: { nested: { deeply: { value: i } } },
          })),
        }

      case 'increment':
        this.counter++
        return { counter: this.counter }

      case 'getCounter':
        return { counter: this.counter }

      case 'complexOperation':
        // Simulate a more complex operation
        await this.state.storage.put('temp', Date.now())
        const stored = await this.state.storage.get('temp')
        await this.state.storage.delete('temp')
        return { stored, processed: true }

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
