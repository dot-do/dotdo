// Root Worker Entry Point
// Minimal passthrough to the DO (Durable Object = Digital Object)
//
// Namespace derivation: tenant.api.dotdo.dev -> DO('tenant')
// All business logic lives in the DO, not the worker.

import { DO } from './do/DO'

// Re-export DO class for wrangler to bind
export { DO }

// Environment interface
interface Env {
  DO: DurableObjectNamespace
  JWT_SECRET?: string
  JWKS_URL?: string
  DO_INTERNAL_SECRET?: string
  ENVIRONMENT?: string
}

// Worker fetch handler - routes to DO based on hostname
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')

    // Extract namespace from subdomain
    // tenant.api.dotdo.dev -> 'tenant'
    // api.dotdo.dev -> 'default'
    const ns = hostParts.length > 2 && hostParts[0] ? hostParts[0] : 'default'

    // Get or create DO instance by namespace
    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
