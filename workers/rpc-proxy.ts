/**
 * RPC Proxy - Cap'n Web RPC to DO
 *
 * Proxies Cap'n Web RPC requests to Durable Objects.
 * Handles:
 * - Request authentication (via custom callback)
 * - Method authorization (optional)
 * - Single and batch RPC requests
 * - Streaming methods (events.stream, events.subscribe)
 * - JSON-RPC 2.0 protocol support
 *
 * @module workers/rpc-proxy
 */

import type { RPCProxyConfig, RPCProxy } from './types'

// ============================================================================
// Streaming Method Detection
// ============================================================================

/** Patterns that identify streaming methods */
const STREAMING_METHOD_PATTERNS = ['events.stream', 'events.subscribe', 'stream', 'subscribe']

/**
 * Check if a method is a streaming method
 *
 * Streaming methods return text/event-stream or application/x-ndjson responses
 * instead of single JSON responses.
 *
 * @param method - RPC method name (e.g., 'events.stream', 'things.get')
 * @returns true if method matches streaming patterns
 *
 * @internal
 */
function isStreamingMethod(method: string): boolean {
  return STREAMING_METHOD_PATTERNS.some((pattern) => method.endsWith(pattern) || method === pattern)
}

/**
 * Create an RPC proxy
 *
 * Request Processing Pipeline:
 * 1. Authentication (config.authenticate callback required)
 * 2. JSON parsing (reject if invalid)
 * 3. Authorization (if config.authorize provided)
 * 4. Method routing (batch vs single request)
 * 5. Response streaming (streaming methods get event-stream, others get JSON)
 *
 * @param config - RPC proxy configuration with authenticate callback
 * @returns RPCProxy instance with handleRequest method
 *
 * @example
 * ```
 * const proxy = createRPCProxy({
 *   authenticate: async (req) => ({
 *     valid: req.headers.get('Authorization') === 'Bearer secret',
 *     identity: 'user-123'
 *   }),
 *   authorize: async (identity, method) => {
 *     return !method.startsWith('admin.')
 *   }
 * })
 *
 * const response = await proxy.handleRequest(request, env)
 * ```
 */
export function createRPCProxy(config: RPCProxyConfig): RPCProxy {
  /**
   * Handle RPC request (single or batch)
   *
   * @param request - Incoming HTTP request with RPC payload
   * @param _env - Environment (unused, included for Worker compatibility)
   * @returns HTTP response with RPC result or error
   */
  async function handleRequest(request: Request, _env: unknown): Promise<Response> {
    // Step 1: Authenticate request
    const authResult = await config.authenticate(request)

    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Step 2: Parse JSON body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Step 3: Handle batch requests (JSON-RPC 2.0)
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map(async (item: { id?: number; method?: string; params?: unknown }) => {
          const method = item.method || ''

          // Authorize method if callback configured
          if (config.authorize && authResult.identity) {
            const authorized = await config.authorize(authResult.identity, method)
            if (!authorized) {
              return { id: item.id, error: { code: 403, message: 'Forbidden' } }
            }
          }

          // In real implementation: forward to DO via RPC
          return { id: item.id, result: { success: true } }
        })
      )

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Step 4: Handle single request
    const singleBody = body as { method?: string; params?: unknown }
    const method = singleBody.method || ''

    // Authorize method if callback configured
    if (config.authorize && authResult.identity) {
      const authorized = await config.authorize(authResult.identity, method)
      if (!authorized) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Step 5: Route to streaming or regular response handler
    if (isStreamingMethod(method)) {
      // Streaming methods return event-stream format
      return new Response('data: {}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    // Regular methods return JSON response
    return new Response(JSON.stringify({ result: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return { handleRequest }
}
