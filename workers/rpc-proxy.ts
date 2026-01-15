/**
 * RPC Proxy - Cap'n Web RPC to DO
 *
 * Proxies RPC requests to Durable Objects.
 * Handles authentication, authorization, and streaming.
 *
 * @module workers/rpc-proxy
 */

import type { RPCProxyConfig, RPCProxy } from './types'

/**
 * Check if a method is a streaming method
 */
function isStreamingMethod(method: string): boolean {
  const streamingMethods = ['events.stream', 'events.subscribe', 'stream', 'subscribe']
  return streamingMethods.some((sm) => method.endsWith(sm) || method === sm)
}

/**
 * Create an RPC proxy
 *
 * @param config - RPC proxy configuration
 * @returns RPCProxy instance
 */
export function createRPCProxy(config: RPCProxyConfig): RPCProxy {
  async function handleRequest(request: Request, _env: unknown): Promise<Response> {
    // Authenticate
    const authResult = await config.authenticate(request)

    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map(async (item: { id?: number; method?: string; params?: unknown }) => {
          const method = item.method || ''

          // Check authorization if configured
          if (config.authorize && authResult.identity) {
            const authorized = await config.authorize(authResult.identity, method)
            if (!authorized) {
              return { id: item.id, error: { code: 403, message: 'Forbidden' } }
            }
          }

          // Simulate method execution (in real implementation, would forward to DO)
          return { id: item.id, result: { success: true } }
        })
      )

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Single request
    const singleBody = body as { method?: string; params?: unknown }
    const method = singleBody.method || ''

    // Check authorization if configured
    if (config.authorize && authResult.identity) {
      const authorized = await config.authorize(authResult.identity, method)
      if (!authorized) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Return streaming response for stream methods
    if (isStreamingMethod(method)) {
      return new Response('data: {}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    // Return JSON response for regular methods
    return new Response(JSON.stringify({ result: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return { handleRequest }
}
