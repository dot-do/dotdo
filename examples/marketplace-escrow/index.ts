// Marketplace Escrow Example Worker Entrypoint
// Routes requests to the EscrowDO

import { EscrowDO } from './EscrowDO'

export { EscrowDO }

interface Env {
  ESCROW: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract namespace from hostname or use default
    // Format: {namespace}.escrow.example.com
    let namespace = 'default'

    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      namespace = hostParts[0]
    }

    // Get or create Durable Object for this namespace
    const id = env.ESCROW.idFromName(namespace)
    const stub = env.ESCROW.get(id)

    // Forward request to the DO
    return stub.fetch(request)
  },
}
