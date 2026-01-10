/**
 * Minimal Proxy Worker
 *
 * Routes requests to Durable Objects based on the first path segment (namespace).
 * All business logic lives in the DO - this worker only handles routing.
 *
 * Routes:
 * - /{ns}                    -> DO(ns).fetch('/')
 * - /{ns}/{path}             -> DO(ns).fetch('/{path}')
 * - /{ns}/rpc                -> DO(ns).fetch('/rpc')
 * - /{ns}/mcp                -> DO(ns).fetch('/mcp')
 * - /{ns}/sync               -> DO(ns).fetch('/sync') [WebSocket]
 * - /{ns}/{collection}/      -> DO(ns).fetch('/{collection}/')
 * - /{ns}/{collection}/{id}  -> DO(ns).fetch('/{collection}/{id}')
 *
 * @module workers/proxy
 */

import type { CloudflareEnv } from '../types/CloudflareBindings'

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Check for empty namespace (path starts with // or is just /)
    // The pathname '//' would have an empty string as the first segment after splitting
    const rawSegments = url.pathname.split('/')
    // rawSegments[0] is always '' (before first /)
    // rawSegments[1] is the namespace (or '' if path is // or /)
    const ns = rawSegments[1]
    if (!ns) {
      return new Response('Not Found', { status: 404 })
    }

    // Check if DO binding exists
    if (!env.DO) {
      return new Response(JSON.stringify({ error: 'DO binding not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Remaining segments are the path to forward
    const segments = rawSegments.filter(Boolean)
    const doPath = '/' + segments.slice(1).join('/')

    try {
      // Get DO stub
      const doId = env.DO.idFromName(ns)
      const stub = env.DO.get(doId)

      // Create new URL for DO request
      const doUrl = new URL(doPath + url.search, url.origin)

      // Forward request to DO
      // Note: duplex is required when passing a body stream in Node.js
      const doRequest = new Request(doUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: 'half',
      } as RequestInit)

      return await stub.fetch(doRequest)
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Service Unavailable' }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  },
}
