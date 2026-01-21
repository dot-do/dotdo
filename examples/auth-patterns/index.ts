// Authentication Patterns Example Worker Entrypoint
// Routes requests to auth Durable Objects

import { AuthDO } from './AuthDO'

export { AuthDO }

interface Env {
  AUTH: DurableObjectNamespace
  JWT_SECRET?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract tenant from hostname or path
    // Format: {tenant}.auth.example.com or /tenant/{tenantId}/...
    let tenantId = 'default'

    // Check for tenant in subdomain
    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      tenantId = hostParts[0]
    }

    // Check for tenant in path
    const tenantMatch = url.pathname.match(/^\/tenant\/([^/]+)/)
    if (tenantMatch) {
      tenantId = tenantMatch[1]
      // Rewrite URL to remove /tenant/{tenantId} prefix
      url.pathname = url.pathname.replace(/^\/tenant\/[^/]+/, '') || '/'
    }

    // Get or create Durable Object for this tenant
    // Each tenant has isolated auth state
    const id = env.AUTH.idFromName(tenantId)
    const stub = env.AUTH.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}
