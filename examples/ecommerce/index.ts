// E-commerce Example Worker Entrypoint
// Routes requests to store-specific Durable Objects

import { EcommerceDO } from './EcommerceDO'

export { EcommerceDO }

interface Env {
  ECOMMERCE: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract store ID from hostname or path
    // Format: {store}.ecommerce.example.com or /store/{storeId}/...
    let storeId = 'default'

    // Check for store in subdomain
    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      storeId = hostParts[0]
    }

    // Check for store in path
    const storeMatch = url.pathname.match(/^\/store\/([^/]+)/)
    if (storeMatch) {
      storeId = storeMatch[1]
      // Rewrite URL to remove /store/{storeId} prefix
      url.pathname = url.pathname.replace(/^\/store\/[^/]+/, '') || '/'
    }

    // Get or create Durable Object for this store
    const id = env.ECOMMERCE.idFromName(storeId)
    const stub = env.ECOMMERCE.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}
